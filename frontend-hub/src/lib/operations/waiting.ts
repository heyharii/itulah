import { useQueries } from "@tanstack/react-query"

import { dc } from "@/lib/api"
import { useEdgeIdentity, useEdgeNodeIdentity } from "@/lib/edge-session"
import { keys } from "@/lib/operations/keys"

/// How often the rail re-asks.
///
/// Work arrives at a warehouse from head office and from the other people on
/// the floor, so a screen left open on a bay must notice a new job without
/// anybody reloading it. A minute: nine questions every thirty seconds, from
/// every page, was most of what an idle tab asked the server (2026-10-05) —
/// and the screens themselves refresh their own lists and push the badge when
/// they change something.
const POLL_MS = 60_000

/// What is waiting, per station — the badges on the rail and the sidebar.
///
/// One hook rather than each screen counting its own. A badge and the screen
/// under it would otherwise disagree for as long as their two caches
/// disagreed, and a rail saying "3" beside a list showing four is a rail
/// nobody looks at again.
export interface Waiting {
  /// Deliveries open on the bay. No badge shows this one: nothing opens a
  /// delivery document by hand any more. It is here because the poll behind it
  /// is what keeps `keys.receipts()` warm, and Receiving's count sheet reads
  /// that cache to find the document to write a count against.
  readonly receipts: number
  readonly toVerify: number
  /// Purchase orders this node is still owed a delivery against — the
  /// Receiving list, counted as orders rather than lines because that is the
  /// row a person walks over to.
  readonly owed: number
  /// Jobs whose labels are not yet confirmed as attached.
  readonly tagging: number
  /// Picklists still to pick — one per allotment × shop, nobody composes one
  /// (owner, 29 Sep 2026). Picking's own badge.
  readonly toPick: number
  /// Shops with something picked and still standing in the pick area, in no
  /// carton — what Packing still has to gather into one (owner, 29 Sep 2026:
  /// a packer opens a SHOP, not a picklist).
  readonly toPack: number
  /// Sealed cartons on no surat jalan yet, or on one not yet on a trip — what
  /// Dispatch can still tick into a trip.
  readonly toDispatch: number
  /// Trucks loaded the old way and never departed. Not reachable through the
  /// one-button trip; kept as its own number so nothing is stranded there
  /// unseen.
  readonly onYard: number
}

const NOTHING: Waiting = {
  receipts: 0,
  toVerify: 0,
  owed: 0,
  tagging: 0,
  toPick: 0,
  toPack: 0,
  toDispatch: 0,
  onYard: 0,
}

export function useWaiting(): Waiting {
  // Eight polling queries against a warehouse node, from a sidebar that is on
  // screen in every module. They run only for somebody actually signed in to
  // that node: without this the hub would poll a DC every thirty seconds on
  // behalf of an accountant who has never opened Operations — and, before the
  // first sign-in, would do it as a burst of 401s.
  // A node with authentication off answers everybody, so there is nothing to
  // wait for — see `screens/operations/gate.tsx`.
  const open = useEdgeNodeIdentity().data?.auth === "DISABLED"
  const signedIn = useEdgeIdentity().data != null || open
  // Written out rather than mapped over a list: `useQueries` infers one result
  // type per entry, and running the entries through `.map` collapses them into
  // a union that no longer knows which query answered what.
  const [receipts, verify, owed, tagging, toPick, picklists, koli, yard] =
    useQueries({
      queries: [
        {
          queryKey: keys.receipts(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.goodsReceipts(signal),
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
          queryKey: keys.purchaseWork(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.purchaseWork(signal),
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
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.picklists(signal),
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
      ],
    })

  const rounds = picklists.data ?? []
  const cartons = koli.data ?? []
  // Distinct shops with something picked and still waiting to be gathered
  // into a carton — Packing's own unit of work, a shop at a time.
  const shopsToPack = new Set(
    rounds
      .filter((round) => round.waiting > 0 && round.destination_id !== null)
      .map((round) => round.destination_id)
  )

  return {
    ...NOTHING,
    receipts: receipts.data?.length ?? 0,
    toVerify: verify.data?.length ?? 0,
    // Orders, not lines: the badge counts the rows on the Receiving list, and
    // one order with nine lines owed is one thing to walk over to.
    owed: new Set((owed.data ?? []).map((line) => line.po_number)).size,
    tagging: tagging.data?.length ?? 0,
    toPick: toPick.data?.length ?? 0,
    toPack: shopsToPack.size,
    // Sealed and either on no surat jalan yet, or on one still on the dock —
    // both are cartons a trip can still tick, and both read `PACKED` or
    // `SHIPMENT` from containment.
    toDispatch: cartons.filter(
      (one) => one.position === "PACKED" || one.position === "SHIPMENT"
    ).length,
    onYard: yard.data?.length ?? 0,
  }
}
