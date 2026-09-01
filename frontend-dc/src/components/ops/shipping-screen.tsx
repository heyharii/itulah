import { useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
} from "@/components/ops/parts"
import { useAction } from "@/lib/action"
import { Note, Pill, ScreenBody, ScreenHeader, ScreenState } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc } from "@/lib/api"
import { clock, units } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { useQuery, useQueryClient } from "@tanstack/react-query"

function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

/// Shipping: boxes gather into a consignment, consignments onto a truck, and
/// the truck leaving is the one stage change on this screen that moves goods
/// in the world rather than in a table.
export function ShippingScreen() {
  const actor = useActor()
  const client = useQueryClient()
  const action = useAction()

  const [pickedBoxes, setPickedBoxes] = useState<ReadonlySet<string>>(new Set())
  const [pickedShipments, setPickedShipments] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [carrier, setCarrier] = useState("")
  const [plate, setPlate] = useState("")
  const [driver, setDriver] = useState("")
  const [openDispatch, setOpenDispatch] = useState<string | null>(null)

  // Sealed and unclaimed. An open box is still being filled and a claimed one
  // already belongs to a consignment, so neither is a choice here.
  const loose = useQuery({
    queryKey: keys.koli({ ready: true, unassigned: true }),
    queryFn: ({ signal }) => dc.koli({ ready: true, unassigned: true }, signal),
  })

  const shipments = useQuery({
    queryKey: keys.shipments({ unassigned: true }),
    queryFn: ({ signal }) => dc.shipments({ unassigned: true }, signal),
  })

  const dispatches = useQuery({
    queryKey: keys.dispatches({ ready: true }),
    queryFn: ({ signal }) => dc.dispatches({ ready: true }, signal),
  })

  const detail = useQuery({
    queryKey: keys.dispatch(openDispatch ?? ""),
    queryFn: ({ signal }) => dc.dispatch(openDispatch as string, signal),
    enabled: openDispatch !== null,
  })

  const refresh = () => void client.invalidateQueries({ queryKey: ["dc"] })

  const buildShipment = () =>
    void action.run(async () => {
      await dc.createShipment({
        koli_ids: [...pickedBoxes],
        actor_id: actor,
      })
      setPickedBoxes(new Set())
      refresh()
    })

  const buildDispatch = () =>
    void action.run(async () => {
      await dc.createDispatch({
        shipment_ids: [...pickedShipments],
        carrier: carrier.trim() === "" ? null : carrier.trim(),
        vehicle_plate: plate.trim() === "" ? null : plate.trim(),
        driver_name: driver.trim() === "" ? null : driver.trim(),
        actor_id: actor,
      })
      setPickedShipments(new Set())
      setCarrier("")
      setPlate("")
      setDriver("")
      refresh()
    })

  return (
    <>
      <ScreenHeader
        title="Shipping"
        subtitle={`${loose.data?.length ?? 0} sealed boxes loose · ${dispatches.data?.length ?? 0} trucks on the yard`}
      />
      <ScreenBody className="lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <Panel
            title="Sealed boxes"
            meta={`${pickedBoxes.size} of ${loose.data?.length ?? 0} chosen`}
          >
            {loose.isPending && <ScreenState>Reading the floor…</ScreenState>}
            {loose.data?.length === 0 && (
              <ScreenState>
                Nothing loose. Every sealed box belongs to a consignment.
              </ScreenState>
            )}
            {loose.data?.map((box) => (
              <Row
                key={box.koli_id}
                selected={pickedBoxes.has(box.koli_id)}
                onClick={() => setPickedBoxes((current) => toggle(current, box.koli_id))}
              >
                <RowText code={box.koli_number}>
                  {box.destination_store_id} · sealed {clock(box.sealed_at)}
                </RowText>
                <RowNumber value={units(box.unit_count)} label="units" />
              </Row>
            ))}
            {pickedBoxes.size > 0 && (
              <div className="border-t px-4 py-3">
                <Button
                  className="h-(--tap) w-full"
                  disabled={action.pending}
                  onClick={buildShipment}
                >
                  Make a consignment of {pickedBoxes.size}
                </Button>
              </div>
            )}
          </Panel>

          <Panel
            title="Consignments without a truck"
            meta={`${pickedShipments.size} of ${shipments.data?.length ?? 0} chosen`}
          >
            {shipments.data?.length === 0 && (
              <ScreenState>
                Every consignment is on a truck. Make one from sealed boxes above.
              </ScreenState>
            )}
            {shipments.data?.map((shipment) => (
              <Row
                key={shipment.shipment_id}
                selected={pickedShipments.has(shipment.shipment_id)}
                onClick={() =>
                  setPickedShipments((current) =>
                    toggle(current, shipment.shipment_id),
                  )
                }
              >
                <RowText code={shipment.shipment_number}>
                  {shipment.destination_store_id} · {shipment.koli_count} boxes
                </RowText>
                <RowNumber value={units(shipment.unit_count)} label="units" />
              </Row>
            ))}
            {pickedShipments.size > 0 && (
              <div className="flex flex-col gap-2 border-t px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={carrier}
                    placeholder="Carrier"
                    className="h-(--tap) min-w-32 flex-1"
                    onChange={(event) => setCarrier(event.target.value)}
                  />
                  <Input
                    value={plate}
                    placeholder="Plate"
                    className="h-(--tap) w-32 font-mono"
                    onChange={(event) => setPlate(event.target.value)}
                  />
                </div>
                <Input
                  value={driver}
                  placeholder="Driver"
                  className="h-(--tap)"
                  onChange={(event) => setDriver(event.target.value)}
                />
                <Button
                  className="h-(--tap)"
                  disabled={action.pending}
                  onClick={buildDispatch}
                >
                  Load {pickedShipments.size} onto a truck
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel
            title="On the yard"
            meta={`${dispatches.data?.length ?? 0} loaded`}
          >
            {dispatches.data?.length === 0 && (
              <ScreenState>
                No truck is loaded and waiting. A departed one is history, not a
                choice, so it is not listed here.
              </ScreenState>
            )}
            {dispatches.data?.map((run) => (
              <div key={run.dispatch_id} className="border-b last:border-b-0">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <RowText code={run.dispatch_number}>
                    {[run.carrier, run.vehicle_plate, run.driver_name]
                      .filter((part) => part !== null)
                      .join(" · ") || "no carrier recorded"}
                  </RowText>
                  <RowNumber value={units(run.koli_count)} label="boxes" />
                  <Button
                    variant="outline"
                    className="h-(--tap)"
                    onClick={() =>
                      setOpenDispatch((current) =>
                        current === run.dispatch_id ? null : run.dispatch_id,
                      )
                    }
                  >
                    {openDispatch === run.dispatch_id ? "Hide" : "Manifest"}
                  </Button>
                  <ConfirmButton
                    label="Depart"
                    className="h-(--tap)"
                    disabled={action.pending}
                    title={`Send ${run.dispatch_number} out`}
                    description={
                      <>
                        This is the one action on this screen that moves goods in
                        the world: {units(run.koli_count)} boxes across{" "}
                        {run.shipment_count} consignments stop being this DC&apos;s
                        stock and become stock in transit. Press it when the truck
                        actually leaves, not when it is loaded.
                      </>
                    }
                    confirmLabel="It has left"
                    onConfirm={() =>
                      void action
                        .run(() => dc.departDispatch(run.dispatch_id))
                        .then((done) => done && refresh())
                    }
                  />
                </div>
                {openDispatch === run.dispatch_id && detail.data !== undefined && (
                  <div className="bg-muted/40 flex flex-col gap-1 px-4 py-3">
                    {detail.data.shipments.map((shipment) => (
                      <div
                        key={shipment.shipment_id}
                        className="flex justify-between gap-3 font-mono text-[11px]"
                      >
                        <span className="truncate">
                          {shipment.shipment_number} → {shipment.destination_store_id}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {shipment.koli_count} boxes · {units(shipment.unit_count)}{" "}
                          units
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Panel>

          <SuratJalan />

          <Problem error={action.error} />

          <Note>
            A consignment is one store&apos;s boxes; a truck run is several
            consignments. Both are gathered here rather than decided — which
            store a box is for was settled when it was packed, and nothing on
            this screen can change it.
          </Note>
        </div>
      </ScreenBody>
    </>
  )
}

/// The consignment note, with the QR a store scans to open the whole thing at
/// once rather than one box at a time.
function SuratJalan() {
  const [shipmentId, setShipmentId] = useState<string | null>(null)

  const shipments = useQuery({
    queryKey: keys.shipments(),
    queryFn: ({ signal }) => dc.shipments({}, signal),
  })

  const detail = useQuery({
    queryKey: keys.shipment(shipmentId ?? ""),
    queryFn: ({ signal }) => dc.shipment(shipmentId as string, signal),
    enabled: shipmentId !== null,
  })

  return (
    <Panel
      title="Consignment note"
      meta={`${shipments.data?.length ?? 0} consignments`}
    >
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        {shipments.data?.map((shipment) => (
          <button
            key={shipment.shipment_id}
            type="button"
            onClick={() =>
              setShipmentId((current) =>
                current === shipment.shipment_id ? null : shipment.shipment_id,
              )
            }
            className={
              shipmentId === shipment.shipment_id
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1.5 font-mono text-[11px]"
                : "bg-muted rounded-full px-3 py-1.5 font-mono text-[11px]"
            }
          >
            {shipment.shipment_number}
          </button>
        ))}
        {shipments.data?.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Nothing has been consigned yet.
          </p>
        )}
      </div>

      {detail.data !== undefined && (
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row">
          <div
            className="[&_svg]:h-28 [&_svg]:w-28 shrink-0"
            aria-label={`QR for ${detail.data.qr_payload}`}
            dangerouslySetInnerHTML={{ __html: detail.data.qr_svg }}
          />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs">
              {detail.data.shipment.destination_store_id} ·{" "}
              <Pill>{detail.data.shipment.position}</Pill>
            </p>
            {detail.data.koli.map((box) => (
              <div
                key={box.koli.koli_id}
                className="flex justify-between gap-3 font-mono text-[11px]"
              >
                <span className="truncate">{box.koli.koli_number}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {units(box.koli.unit_count)} units
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}
