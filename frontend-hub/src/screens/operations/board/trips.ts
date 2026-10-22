import { count } from "@/lib/format"
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

/// Pieces a store reports short on this trip and nobody has found yet: the
/// centre's open gap. Zero until the store has counted.
export const shortOf = (stop: Trip["stops"][number]) =>
  stop.received?.open_gap_qty ?? 0

/// Whether MD still has a store of a trip to answer (`useOpenReviews`).
/// Absent: not known yet, read as still open.
export type OpenReview = (dispatchId: string, storeId: string) => boolean

/// Some store on the trip counted fewer than were sent and MD has not
/// answered it yet.
export const hasShort = (trip: Trip, open?: OpenReview) =>
  trip.stops.some(
    (one) =>
      shortOf(one) > 0 &&
      (open?.(trip.trip.dispatch_id, one.shipment.destination_store_id) ?? true)
  )

/// How one store stands on the trip, in the words the card and the pill use:
/// "Short −1 · Extra +1 · MD reviews" while a short is open (pack-sheet-options).
/// An extra alone is not an open question: nothing says MD has not settled it,
/// so the store reads "Received" and the sheet's Difference shows the extra.
export function stopState(
  stop: Trip["stops"][number],
  /// MD still has this store to answer; `false` once answered (e2e 20 Oct
  /// 2026: answered trips still read "MD reviews" on the board).
  open = true
): {
  tone: "info" | "ok" | "warn"
  label: string
} {
  const short = shortOf(stop)
  const extra = stop.received?.extra_qty ?? 0
  if (short > 0 && !open)
    return { tone: "ok", label: `Short −${count(short)} · Decided` }
  if (short > 0)
    return {
      tone: "warn",
      label: [
        short > 0 ? `Short −${count(short)}` : null,
        extra > 0 ? `Extra +${count(extra)}` : null,
        "MD reviews",
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
    }
  return arrived(stop)
    ? { tone: "ok", label: "Received" }
    : { tone: "info", label: "In transit" }
}
