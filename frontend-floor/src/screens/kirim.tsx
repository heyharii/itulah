import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Boxes, FileText, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, RecordCard } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { describe } from "@/lib/errors"
import { ago, count, label, moment, toneFor } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { keys, reads } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { Koli } from "@itulah/contract"

type ShipmentProgressJob = {
  readonly shipmentNumber: string
  readonly koliIds: readonly string[]
}

function fulfillmentKey(koliId: string, stage: string) {
  return `floor-fulfillment-${koliId}-${stage}`
}

async function settleFulfillment(requests: readonly Promise<unknown>[]) {
  const results = await Promise.allSettled(requests)
  const failure = results.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}

/// The door: cartons gather into consignments, consignments onto a truck, and
/// the truck leaves.
///
/// **None of this goes through the outbox**, and that is the rule this screen is
/// built on. Every action here produces a number somebody then acts on — a
/// consignment the next station asks for, a dispatch a driver signs, a departure
/// that is the last moment this building can say anything about the goods. A
/// queued consignment would be a number that does not exist yet, printed on a
/// document, handed to a driver.
///
/// So these are ordinary writes: they fail loudly, in front of the person who
/// pressed, who is standing at the door and can do something about it.
export function Kirim() {
  const view = useParam("lihat")
  const slice =
    view.value === "kiriman" || view.value === "truk" ? view.value : "koli"

  return (
    <Screen>
      <div className="pt-1 pb-4">
        <Segmented
          value={slice}
          onChange={(next) => view.set(next)}
          options={[
            { value: "koli", label: "Koli" },
            { value: "kiriman", label: "Kiriman" },
            { value: "truk", label: "Truk" },
          ]}
        />
      </div>

      {slice === "koli" ? (
        <LooseKoli />
      ) : slice === "kiriman" ? (
        <Shipments />
      ) : (
        <Trucks />
      )}
    </Screen>
  )
}

/// Sealed cartons nobody has gathered yet, grouped by the shop they are for.
///
/// The grouping is not presentation: **one consignment carries one
/// destination**, and the node refuses a mixed one ("koli in one shipment must
/// share a destination"). A flat list with checkboxes would let somebody build a
/// mixed selection and meet that sentence only after pressing. Grouped, the
/// mistake cannot be made.
function LooseKoli() {
  const client = useQueryClient()
  const actor = useActor()
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set())
  const [progressJob, setProgressJob] = useState<ShipmentProgressJob | null>(
    null,
  )

  const loose = useQuery(reads.koli({ unassigned: true, ready: true }))

  const recordShipmentProgress = useMutation({
    mutationFn: (job: ShipmentProgressJob) =>
      settleFulfillment(
        job.koliIds.map((koliId) =>
          dc.koliToShipment(koliId, {
            shipment_reference: job.shipmentNumber,
            actor_id: actor,
            idempotency_key: fulfillmentKey(koliId, "shipment"),
          }),
        ),
      ),
    onSuccess: () => {
      setProgressJob(null)
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const shops = useMemo(() => {
    const byShop = new Map<string, Koli[]>()
    for (const box of loose.data ?? []) {
      const held = byShop.get(box.destination_store_id)
      if (held === undefined) byShop.set(box.destination_store_id, [box])
      else held.push(box)
    }
    return [...byShop.entries()]
  }, [loose.data])

  const create = useMutation({
    mutationFn: async (koliIds: readonly string[]) => ({
      shipment: await dc.createShipment({
        koli_ids: [...koliIds],
        actor_id: actor,
      }),
      koliIds,
    }),
    onSuccess: ({ shipment, koliIds }) => {
      setDropped(new Set())
      void client.invalidateQueries({ queryKey: keys.dc.all })
      const job = { shipmentNumber: shipment.shipment_number, koliIds }
      setProgressJob(job)
      recordShipmentProgress.mutate(job)
    },
  })

  return queryState(loose, {
    loading: "Menanyakan koli tersegel…",
    render: (boxes) => (
      <>
        {create.isError && (
          <Banner tone="bad" className="mb-4">
            {describe(create.error)}
          </Banner>
        )}
        {recordShipmentProgress.isError && progressJob !== null && (
          <Banner tone="bad" className="mb-4">
            Shipment {progressJob.shipmentNumber} sudah dibuat, tetapi
            perpindahan koli belum seluruhnya tercatat.{" "}
            {describe(recordShipmentProgress.error)}
            <Button
              className="mt-3"
              disabled={recordShipmentProgress.isPending}
              onClick={() => recordShipmentProgress.mutate(progressJob)}
            >
              Ulangi pencatatan shipment
            </Button>
          </Banner>
        )}
        {boxes.length === 0 ? (
          <EmptyState>
            Tidak ada koli tersegel yang menunggu. Koli sampai di sini begitu
            stasiun kemas menyegelnya.
          </EmptyState>
        ) : (
          <Section title="Koli tersegel">
            <CardList>
              {shops.map(([shop, group]) => {
                const chosen = group.filter((box) => !dropped.has(box.koli_id))
                return (
                  <Card key={shop} className="px-3.5 py-3">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
                        {shop}
                      </span>
                      <Pill tone="info">
                        {count(
                          chosen.reduce(
                            (total, box) => total + box.unit_count,
                            0,
                          ),
                        )}{" "}
                        potong
                      </Pill>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {group.map((box) => {
                        const on = !dropped.has(box.koli_id)
                        return (
                          <button
                            key={box.koli_id}
                            type="button"
                            onClick={() =>
                              setDropped((current) => {
                                const next = new Set(current)
                                if (next.has(box.koli_id))
                                  next.delete(box.koli_id)
                                else next.add(box.koli_id)
                                return next
                              })
                            }
                            className={cn(
                              "h-11 rounded-inner border px-3.5 font-mono text-[0.6875rem] font-semibold",
                              on
                                ? "border-accent bg-accent text-on-dark"
                                : "border-hairline-2 bg-canvas text-body",
                            )}
                          >
                            {box.koli_number}
                          </button>
                        )
                      })}
                    </div>

                    <Button
                      variant="primary"
                      block
                      disabled={
                        chosen.length === 0 ||
                        create.isPending ||
                        recordShipmentProgress.isPending ||
                        progressJob !== null
                      }
                      onClick={() =>
                        create.mutate(chosen.map((box) => box.koli_id))
                      }
                    >
                      Buat kiriman · {count(chosen.length)} koli
                    </Button>
                  </Card>
                )
              })}
            </CardList>
          </Section>
        )}
      </>
    ),
  })
}

/// Consignments with no truck yet, and the form that puts them on one.
///
/// The carrier, the plate and the driver are typed **here**, at creation, because
/// that is the only moment the node takes them: `CreateDispatchRequest` carries
/// them and there is no route that amends a dispatch afterwards. A screen that
/// collected them later would be collecting them into nothing.
function Shipments() {
  const client = useQueryClient()
  const go = useGo()
  const actor = useActor()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [carrier, setCarrier] = useState("")
  const [plate, setPlate] = useState("")
  const [driver, setDriver] = useState("")

  const shipments = useQuery(reads.shipments({ unassigned: true }))

  const create = useMutation({
    mutationFn: () =>
      dc.createDispatch({
        shipment_ids: [...picked],
        carrier: carrier.trim() === "" ? null : carrier.trim(),
        vehicle_plate: plate.trim() === "" ? null : plate.trim(),
        driver_name: driver.trim() === "" ? null : driver.trim(),
        actor_id: actor,
      }),
    onSuccess: (dispatch) => {
      setPicked(new Set())
      setCarrier("")
      setPlate("")
      setDriver("")
      void client.invalidateQueries({ queryKey: keys.dc.all })
      go("/kirim/muat", { id: dispatch.dispatch_id })
    },
  })

  return queryState(shipments, {
    loading: "Menanyakan kiriman…",
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>
          Semua kiriman sudah punya truk. Kiriman baru muncul di sini setelah
          koli digabungkan.
        </EmptyState>
      ) : (
        <>
          {create.isError && (
            <Banner tone="bad" className="mb-4">
              {describe(create.error)}
            </Banner>
          )}

          <Section title="Belum punya truk">
            <CardList>
              {rows.map((shipment) => {
                const on = picked.has(shipment.shipment_id)
                return (
                  <RecordCard
                    key={shipment.shipment_id}
                    icon={<FileText />}
                    id={shipment.shipment_number}
                    status={
                      on ? (
                        <Pill tone="accent">dipilih</Pill>
                      ) : (
                        <Pill tone={toneFor(shipment.position)}>
                          {label(shipment.position)}
                        </Pill>
                      )
                    }
                    onPress={() =>
                      setPicked((current) => {
                        const next = new Set(current)
                        if (next.has(shipment.shipment_id))
                          next.delete(shipment.shipment_id)
                        else next.add(shipment.shipment_id)
                        return next
                      })
                    }
                    className={cn(on && "border-ink")}
                  >
                    <div className="px-3.5 pt-2 pb-3">
                      <KeyValue term="Tujuan">
                        {shipment.destination_store_id}
                      </KeyValue>
                      <KeyValue term="Koli">
                        {count(shipment.koli_count)} ·{" "}
                        {count(shipment.unit_count)} potong
                      </KeyValue>
                    </div>
                  </RecordCard>
                )
              })}
            </CardList>
          </Section>

          {picked.size > 0 && (
            <Section title={`Muatan · ${count(picked.size)} kiriman`}>
              <Card className="flex flex-col gap-3 px-3.5 py-3.5">
                <Field label="Ekspedisi" hint="Boleh dikosongkan.">
                  <Input
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                    placeholder="mis. JNE Trucking"
                  />
                </Field>
                <Field label="Nomor polisi">
                  <Input
                    value={plate}
                    autoCapitalize="characters"
                    onChange={(event) => setPlate(event.target.value)}
                    placeholder="B 1234 XYZ"
                  />
                </Field>
                <Field label="Sopir">
                  <Input
                    value={driver}
                    onChange={(event) => setDriver(event.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Membuat…" : "Buat muatan"}
                </Button>
              </Card>
            </Section>
          )}
        </>
      ),
  })
}

/// Trucks still on the yard.
function Trucks() {
  const go = useGo()
  const yard = useQuery(reads.dispatches({ ready: true }))

  return queryState(yard, {
    loading: "Menanyakan truk…",
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>
          Tidak ada truk di halaman. Muatan muncul di sini setelah kiriman
          digabungkan jadi satu muatan.
        </EmptyState>
      ) : (
        <Section title="Di halaman">
          <CardList>
            {rows.map((run) => (
              <RecordCard
                key={run.dispatch_id}
                icon={run.departed_at === null ? <Truck /> : <Boxes />}
                id={run.dispatch_number}
                status={
                  run.departed_at === null ? (
                    <Pill tone="warn">belum berangkat</Pill>
                  ) : (
                    <Pill tone="ok">berangkat {ago(run.departed_at)}</Pill>
                  )
                }
                onPress={() => go("/kirim/muat", { id: run.dispatch_id })}
              >
                <div className="px-3.5 pt-2 pb-3">
                  <KeyValue term="Kiriman">
                    {count(run.shipment_count)} · {count(run.koli_count)} koli
                  </KeyValue>
                  <KeyValue term="Kendaraan">
                    {run.vehicle_plate ?? "—"}
                  </KeyValue>
                  <KeyValue term="Sopir">{run.driver_name ?? "—"}</KeyValue>
                  {run.departed_at !== null && (
                    <KeyValue term="Berangkat">
                      {moment(run.departed_at)}
                    </KeyValue>
                  )}
                </div>
              </RecordCard>
            ))}
          </CardList>
        </Section>
      ),
  })
}
