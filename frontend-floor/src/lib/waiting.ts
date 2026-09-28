import { useQueries } from "@tanstack/react-query"

import { reads } from "@/lib/queries"

/// How often the floor re-asks.
///
/// Work arrives at a warehouse from head office and from the other people on the
/// floor, so a phone left on a bench must notice a new job without anybody
/// reloading it. Thirty seconds is the interval the warehouse console settled on
/// and nobody complained about.
const POLL_MS = 30_000

/// What is waiting, per station.
///
/// One hook rather than each screen counting its own. A work list and the screen
/// under it would otherwise disagree for as long as their two caches disagreed,
/// and a card saying "3" beside a list showing four is a card nobody looks at
/// again.
export interface Waiting {
  /// Orders this node is still owed a delivery against, counted as orders rather
  /// than lines: one order with nine lines owed is one lorry to walk over to.
  readonly owed: number
  /// Counts waiting for a second person. The other half of receiving, and
  /// deliberately its own number — nothing becomes stock until somebody who did
  /// not count it says so.
  readonly toVerify: number
  /// Label-print jobs still open — their goods are already stock; only the
  /// printing is left.
  readonly tagging: number
  /// SKUs still owed to shops, and the pieces behind them.
  readonly pickLines: number
  readonly pickUnits: number
  /// Shops with something packable waiting, and cartons still open.
  readonly shops: number
  readonly openBoxes: number
  /// Sealed cartons nobody has gathered into a consignment yet, consignments
  /// with no truck, and trucks still on the yard.
  readonly looseBoxes: number
  readonly unshipped: number
  readonly onYard: number
  /// Stock takes this node has been told to walk.
  readonly counts: number
  /// Whether any of the nine reads has actually answered yet. A work list of
  /// eight zeroes looks like a finished warehouse, and on a cold start it means
  /// the opposite.
  readonly known: boolean
  /// Every read failed. On this surface that nearly always means one thing —
  /// the phone cannot reach the node — and it has to be said out loud, because
  /// the alternative is a work list that quietly shows yesterday's numbers, or
  /// none, with no explanation.
  readonly offline: boolean
}

const NOTHING = {
  owed: 0,
  toVerify: 0,
  tagging: 0,
  pickLines: 0,
  pickUnits: 0,
  shops: 0,
  openBoxes: 0,
  looseBoxes: 0,
  unshipped: 0,
  onYard: 0,
  counts: 0,
} as const

export function useWaiting(): Waiting {
  // Written out rather than mapped over a list: `useQueries` infers one result
  // type per entry, and running the entries through `.map` collapses them into a
  // union that no longer knows which query answered what.
  const [owed, verify, tagging, picklist, destinations, koli, shipments, yard, counts] =
    useQueries({
      queries: [
        { ...reads.purchaseWork(), refetchInterval: POLL_MS },
        { ...reads.verifyQueue(), refetchInterval: POLL_MS },
        { ...reads.taggingJobs(), refetchInterval: POLL_MS },
        { ...reads.picklist(), refetchInterval: POLL_MS },
        { ...reads.destinations(), refetchInterval: POLL_MS },
        { ...reads.koli(), refetchInterval: POLL_MS },
        { ...reads.shipments({ unassigned: true }), refetchInterval: POLL_MS },
        { ...reads.dispatches({ ready: true }), refetchInterval: POLL_MS },
        { ...reads.counts(), refetchInterval: POLL_MS },
      ],
    })

  const everything = [
    owed,
    verify,
    tagging,
    picklist,
    destinations,
    koli,
    shipments,
    yard,
    counts,
  ]
  const lines = picklist.data ?? []
  const boxes = koli.data ?? []

  return {
    ...NOTHING,
    owed: new Set((owed.data ?? []).map((line) => line.po_number)).size,
    toVerify: verify.data?.length ?? 0,
    tagging: tagging.data?.length ?? 0,
    pickLines: lines.length,
    pickUnits: lines.reduce((total, line) => total + line.outstanding, 0),
    shops: (destinations.data ?? []).filter((shop) => shop.packable > 0).length,
    openBoxes: boxes.filter((box) => box.sealed_at === null).length,
    // Sealed and unclaimed: the pile a supervisor builds a consignment from.
    looseBoxes: boxes.filter(
      (box) => box.sealed_at !== null && box.shipment_id === null,
    ).length,
    unshipped: shipments.data?.length ?? 0,
    onYard: yard.data?.length ?? 0,
    // Only the ones actually being walked. A closed stock take is a document, not
    // a job, and counting it here would leave a card on the work list forever.
    counts: (counts.data ?? []).filter((row) => row.status === "ACTIVE").length,
    known: everything.some((query) => query.data !== undefined),
    // Not `every(isError)`. A polled query that has never had an answer sits at
    // `pending` between its attempts — see `lib/query-state.tsx` — so a work list
    // that waited for `isError` waited forever, which on a floor reads as "the
    // app is thinking" rather than "the wifi is gone".
    offline: everything.every(
      (query) => query.data === undefined && query.failureCount > 0,
    ),
  }
}
