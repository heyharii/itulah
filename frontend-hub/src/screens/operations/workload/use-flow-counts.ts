import { useQueries } from "@tanstack/react-query"
import { useState } from "react"

import { dc, dcPurchaseReturns } from "@/lib/api"
import { useEdgeIdentity, useEdgeNodeIdentity } from "@/lib/edge-session"
import { keys } from "@/lib/operations/keys"
import { receivedShipments } from "@/screens/operations/board/received"
import {
  supplierReturnKeys,
  supplierReturns,
} from "@/screens/operations/board/supplier-returns"

/// Same interval as the rail's badges (`lib/operations/waiting.ts`), so a
/// stage count here and the board it links to never disagree for longer than
/// one poll.
const POLL_MS = 30_000

/// A received surat jalan stays counted for this long — the same window the
/// Allotment board's Received lane draws (`board/board.tsx`), so the card and
/// the lane it opens show the same deliveries.
const RECEIVED_DAYS = 7

/// The four flows' stage counts, one per card on the Workload bento.
///
/// A flow is `null` whole while any of its queries is still loading — the
/// screen shows a dash rather than a half-answer, because a card reading
/// "3 · 0 · —" invites somebody to believe the zero.
export interface FlowCounts {
  /// The receiving bay: orders still owed a count, counts waiting for the
  /// buyer, deliveries with goods already accepted, tagging jobs issued.
  readonly po: {
    readonly list: number
    readonly review: number
    readonly received: number
    readonly tags: number
  } | null
  /// The Allotment board, station by station: rounds to pick, shops with
  /// picked goods standing in the pick area, sealed cartons, cartons on a
  /// surat jalan plus ready trips, and what the stores have counted at
  /// their doors.
  readonly outbox: {
    readonly pick: number
    readonly picked: number
    readonly pack: number
    readonly dispatch: number
    readonly received: number
  } | null
  /// A store's return, from the lorry to the racks: on the road, counted at
  /// the door, inspection in progress or owed, inspection finished.
  readonly store: {
    readonly transit: number
    readonly count: number
    readonly review: number
    readonly received: number
  } | null
  /// Returns to suppliers, edge and cloud together: to hand over, with the
  /// supplier, part settled, finished.
  readonly rts: {
    readonly list: number
    readonly dispatch: number
    readonly resolution: number
    readonly completed: number
  } | null
}

/// Stage counts for every flow card on Workload, in one hook.
///
/// One hook rather than a query per card, as in `useWaiting`: the four cards
/// would otherwise poll the same endpoints four times under four names and
/// disagree with each other for as long as their caches disagreed. These are
/// the same cache keys the boards themselves read, so a card, its board and
/// the sidebar badge all share one answer.
export function useFlowCounts(): FlowCounts {
  // Thirteen polling queries. They run only for somebody actually signed in
  // to the DC node, as in `useWaiting` — without this the hub would poll a
  // warehouse every thirty seconds on behalf of an accountant who has never
  // opened Operations.
  const open = useEdgeNodeIdentity().data?.auth === "DISABLED"
  const signedIn = useEdgeIdentity().data != null || open
  // A window that slid on every render would be a new cache key and a new
  // request each time, so it is fixed when the hook first runs — exactly as
  // the Allotment board fixes its own.
  const [since] = useState(() =>
    new Date(Date.now() - RECEIVED_DAYS * 86_400_000).toISOString()
  )
  // Written out rather than mapped over a list: `useQueries` infers one
  // result type per entry, and running the entries through `.map` collapses
  // them into a union that no longer knows which query answered what.
  const [
    work,
    verify,
    receipts,
    tagging,
    toPick,
    rounds,
    koli,
    trips,
    received,
    inbound,
    inspections,
    edgeReturns,
    cloudReturns,
  ] = useQueries({
    queries: [
      {
        queryKey: keys.purchaseWork(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.purchaseWork(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.verifyQueue(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.countsAwaitingVerification(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.receipts(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.goodsReceipts(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.taggingJobs(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.taggingJobs(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.picklistsToPick(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.picklistsToPick(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.picklists(),
        queryFn: ({ signal }: { signal: AbortSignal }) => dc.picklists(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.koli({ ready: true }),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.koli({ ready: true }, signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.dispatches({ ready: true }),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.dispatches({ ready: true }, signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.receivedShipments(since),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          receivedShipments(since, signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.storeInbound(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.storeInboundList(undefined, signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.returnInspections(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.returnInspections(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: keys.purchaseReturns(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dcPurchaseReturns(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
      {
        queryKey: supplierReturnKeys.all,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          supplierReturns(signal),
        refetchInterval: POLL_MS,
        enabled: signedIn,
      },
    ],
  })

  // A flow answers only when every query behind it has answered.
  const poReady =
    !work.isPending &&
    !verify.isPending &&
    !receipts.isPending &&
    !tagging.isPending
  const outboxReady =
    !toPick.isPending &&
    !rounds.isPending &&
    !koli.isPending &&
    !trips.isPending &&
    !received.isPending
  const storeReady = !inbound.isPending && !inspections.isPending
  const rtsReady = !edgeReturns.isPending && !cloudReturns.isPending

  // Shops with something picked and still standing in the pick area — the
  // same count Packing's badge shows (`useWaiting.toPack`).
  const shopsToPack = new Set(
    (rounds.data ?? [])
      .filter((round) => round.waiting > 0 && round.destination_id !== null)
      .map((round) => round.destination_id)
  )
  const cartons = koli.data ?? []

  // The return-from-store bench, read as the four stages a delivery moves
  // through. `returnInspections` carries the pool arithmetic per received
  // delivery, so a delivery is:
  //   counted  — received, and nothing has moved out of its return pool yet;
  //   review   — partly inspected, plus any received delivery the inspection
  //              list does not know (nothing recorded means nobody has looked,
  //              and that needs a person before it needs a shelf);
  //   received — pool empty with units inspected: the return is worked off.
  const inspectionRows = inspections.data ?? []
  const inspectedIds = new Set(inspectionRows.map((row) => row.delivery_id))
  const unlooked = (inbound.data ?? []).filter(
    (delivery) =>
      delivery.status === "RECEIVED" && !inspectedIds.has(delivery.delivery_id)
  ).length

  const edge = edgeReturns.data ?? []
  const cloud = cloudReturns.data ?? []

  return {
    po: poReady
      ? {
          // Orders, not lines: one order with nine lines owed is one thing
          // to walk over to, as on the Receiving list.
          list: new Set((work.data ?? []).map((line) => line.po_number)).size,
          review: verify.data?.length ?? 0,
          received: (receipts.data ?? []).filter(
            (one) => one.accepted_lines > 0
          ).length,
          tags: tagging.data?.length ?? 0,
        }
      : null,
    outbox: outboxReady
      ? {
          pick: toPick.data?.length ?? 0,
          picked: shopsToPack.size,
          pack: cartons.filter((one) => one.position === "PACKED").length,
          // Sealed onto a surat jalan still on the dock, plus the trips
          // themselves ready to load — both are Dispatch's to move.
          dispatch:
            cartons.filter((one) => one.position === "SHIPMENT").length +
            (trips.data?.length ?? 0),
          received: received.data?.items.length ?? 0,
        }
      : null,
    store: storeReady
      ? {
          transit: (inbound.data ?? []).filter(
            (delivery) => delivery.status === "IN_TRANSIT"
          ).length,
          count: inspectionRows.filter(
            (row) => row.waiting_units > 0 && row.inspected_units === 0
          ).length,
          review:
            inspectionRows.filter(
              (row) => row.inspected_units > 0 && row.waiting_units > 0
            ).length + unlooked,
          received: inspectionRows.filter(
            (row) => row.waiting_units === 0 && row.inspected_units > 0
          ).length,
        }
      : null,
    rts: rtsReady
      ? {
          // Raised at this node and waiting for the Gudang, plus raised from
          // HO return stock and waiting to be handed over.
          list:
            edge.filter((one) => one.status === "OPEN").length +
            cloud.filter((one) => one.status === "TO_HAND_OVER").length,
          dispatch: cloud.filter((one) => one.status === "WAITING").length,
          resolution: cloud.filter((one) => one.status === "PARTLY_SETTLED")
            .length,
          completed:
            edge.filter((one) => one.status === "HANDED_OVER").length +
            cloud.filter(
              (one) => one.status === "SETTLED" || one.status === "CLOSED_SHORT"
            ).length,
        }
      : null,
  }
}
