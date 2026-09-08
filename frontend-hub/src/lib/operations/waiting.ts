import { useQueries } from "@tanstack/react-query"

import { dc } from "@/lib/api"
import { useEdgeIdentity, useEdgeNodeIdentity } from "@/lib/edge-session"
import { keys } from "@/lib/operations/keys"

/// How often the rail re-asks.
///
/// Work arrives at a warehouse from head office and from the other people on
/// the floor, so a screen left open on a bay must notice a new job without
/// anybody reloading it. Thirty seconds is the interval the app this replaces
/// settled on and nobody complained about.
const POLL_MS = 30_000

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
  /// SKUs still owed, and the pieces behind them.
  readonly pickLines: number
  readonly pickUnits: number
  /// Boxes still open, so still fillable.
  readonly openBoxes: number
  /// Sealed boxes nobody has gathered into a consignment yet.
  readonly looseBoxes: number
  /// Consignments with no truck, and trucks still on the yard.
  readonly unshipped: number
  readonly onYard: number
}

const NOTHING: Waiting = {
  receipts: 0,
  toVerify: 0,
  owed: 0,
  tagging: 0,
  pickLines: 0,
  pickUnits: 0,
  openBoxes: 0,
  looseBoxes: 0,
  unshipped: 0,
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
  const [receipts, verify, owed, tagging, picklist, koli, shipments, yard] =
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
          queryKey: keys.picklist(),
          queryFn: ({ signal }: { signal: AbortSignal }) => dc.picklist(signal),
          refetchInterval: POLL_MS,
          enabled: signedIn,
        },
        {
          queryKey: keys.koli(),
          queryFn: ({ signal }: { signal: AbortSignal }) => dc.koli({}, signal),
          refetchInterval: POLL_MS,
          enabled: signedIn,
        },
        {
          queryKey: keys.shipments({ unassigned: true }),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.shipments({ unassigned: true }, signal),
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

  const lines = picklist.data ?? []
  const boxes = koli.data ?? []

  return {
    ...NOTHING,
    receipts: receipts.data?.length ?? 0,
    toVerify: verify.data?.length ?? 0,
    // Orders, not lines: the badge counts the rows on the Receiving list, and
    // one order with nine lines owed is one thing to walk over to.
    owed: new Set((owed.data ?? []).map((line) => line.po_number)).size,
    tagging: tagging.data?.length ?? 0,
    pickLines: lines.length,
    pickUnits: lines.reduce((total, line) => total + line.outstanding, 0),
    openBoxes: boxes.filter((box) => box.sealed_at === null).length,
    // Sealed and unclaimed: the pile a supervisor builds a consignment from.
    looseBoxes: boxes.filter(
      (box) => box.sealed_at !== null && box.shipment_id === null
    ).length,
    unshipped: shipments.data?.length ?? 0,
    onYard: yard.data?.length ?? 0,
  }
}
