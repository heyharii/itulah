import { tripDocumentNumber } from "@/lib/operations/trip-number"
import type { Dispatch, ReceivedShipment, Shipment } from "@itulah/contract"

/// One trip in the Dispatched history: when it left, the stores on it, and
/// what each store has said at its door.
export interface Trip {
  readonly trip: Dispatch
  readonly number: string
  readonly left: string
  readonly stops: readonly {
    readonly shipment: Shipment
    readonly received: ReceivedShipment | undefined
  }[]
}

/// Every trip that left, newest first. A delivery note a store has received
/// is matched by its number, the only key the centre's list knows.
export function tripsOf(
  trips: readonly Dispatch[],
  shipments: readonly Shipment[],
  received: readonly ReceivedShipment[]
): Trip[] {
  const byNumber = new Map(received.map((one) => [one.shipment_number, one]))
  return trips
    .filter((trip) => trip.departed_at !== null)
    .map((trip) => {
      const own = shipments.filter(
        (one) => one.dispatch_id === trip.dispatch_id
      )
      return {
        trip,
        number: tripDocumentNumber(trip, own),
        left: trip.departed_at ?? "",
        stops: own.map((shipment) => ({
          shipment,
          received: byNumber.get(shipment.shipment_number),
        })),
      }
    })
    .filter((one) => one.stops.length > 0)
    .sort((left, right) => right.left.localeCompare(left.left))
}

/// A stop is received once the store counted it, or the node no longer has
/// it on the road.
export const arrived = (stop: Trip["stops"][number]) =>
  stop.received !== undefined || stop.shipment.position !== "IN_TRANSIT"

/// Still on the road: some store on it has not received yet.
export const onTheRoad = (trip: Trip) => trip.stops.some((one) => !arrived(one))
