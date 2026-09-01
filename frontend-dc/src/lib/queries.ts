import { useQueries } from "@tanstack/react-query"

import { dc, poolsAnswer } from "@/lib/api"
import type { ListFilter } from "@itulah/contract/client"

/// A key that changes whenever a request's answer could change.
///
/// Written out here rather than composed at each call site. A warehouse screen
/// writes and then re-reads constantly — seal a box, refresh the box list —
/// and a mutation that invalidated a key nobody was watching would leave a
/// sealed carton showing as open until somebody reloaded the page.
export const keys = {
  /// Who is signed in, and which node this is. Not under `dc` because signing
  /// out removes that whole domain and writes `null` here in its place — these
  /// two are what decides whether anything else may be asked at all.
  session: () => ["auth", "me"] as const,
  node: () => ["node", "identity"] as const,
  /// What this node has not managed to send yet. Polled from the shell, so it
  /// is a key of its own rather than part of the operations badges.
  syncStatus: () => ["node", "sync-status"] as const,

  receipts: () => ["dc", "goods-receipts"] as const,
  purchaseWork: () => ["dc", "purchase-work"] as const,
  verifyQueue: () => ["dc", "purchase-counts"] as const,

  taggingJobs: () => ["dc", "tagging-jobs"] as const,
  /// Keyed by the job, not the session: the run belongs to the job, and a
  /// screen that reloaded knows only which job it was printing.
  jobPrintSession: (jobId: string) =>
    ["dc", "tagging-job", jobId, "print-session"] as const,

  picklist: () => ["dc", "picklist"] as const,
  pickSessions: () => ["dc", "pick-sessions"] as const,
  pickSession: (sessionId: string) =>
    ["dc", "pick-session", sessionId] as const,

  packingSessions: () => ["dc", "packing-sessions"] as const,
  packingSession: (sessionId: string) =>
    ["dc", "packing-session", sessionId] as const,
  /// The RFID box being filled against a target, which is a different thing
  /// from the packing round it may or may not belong to.
  packingBox: (sessionId: string) => ["dc", "packing-box", sessionId] as const,
  outstanding: (storeId: string) => ["dc", "outstanding", storeId] as const,
  koli: (filter: ListFilter = {}) => ["dc", "koli", filter] as const,
  koliManifest: (koliId: string) => ["dc", "koli", koliId, "manifest"] as const,

  shipments: (filter: ListFilter = {}) => ["dc", "shipments", filter] as const,
  shipment: (shipmentId: string) => ["dc", "shipment", shipmentId] as const,
  dispatches: (filter: ListFilter = {}) =>
    ["dc", "dispatches", filter] as const,
  dispatch: (dispatchId: string) => ["dc", "dispatch", dispatchId] as const,

  officialCounts: () => ["dc", "official-counts"] as const,
  officialCount: (countId: string) =>
    ["dc", "official-count", countId] as const,

  pools: () => ["inventory", "pools"] as const,
  movements: () => ["inventory", "movements"] as const,
} as const

/// How often the nav re-asks. Work arrives from head office and from the other
/// people on the floor, so a warehouse screen left open must notice a new job
/// without anybody reloading it.
const QUEUE_POLL_MS = 30_000

/// What is waiting, per operation, for the badges in the nav and the tiles on
/// the work queue.
///
/// One hook rather than each screen counting its own: the badge and the screen
/// would otherwise disagree for as long as their two caches disagreed, and a
/// nav saying "3" beside a list showing four is a nav nobody trusts again.
export interface OperationCounts {
  /// Deliveries open on the bay, and counts waiting for a second person.
  readonly receipts: number
  readonly awaitingVerification: number
  /// Jobs whose labels are not yet confirmed as attached.
  readonly tagging: number
  /// SKUs still owed, and the pieces behind them.
  readonly picklistLines: number
  readonly picklistUnits: number
  /// Boxes still open, so still fillable.
  readonly unsealedKoli: number
  /// Sealed boxes nobody has gathered into a consignment yet.
  readonly loose: number
  /// Consignments with no truck, and trucks still on the yard.
  readonly unshipped: number
  readonly onYard: number
  /// Counts activated by the centre and not yet submitted.
  readonly openCounts: number
  /// Pieces known to exist and not found where they should be. Not a queue —
  /// nobody works a list of them — but the one number on this node that means
  /// something is wrong rather than merely unfinished.
  readonly missing: number
}

export function useOperationCounts(): OperationCounts {
  // Written out rather than mapped over a list: `useQueries` infers one result
  // type per entry, and running the entries through `.map` collapses them into
  // a union that no longer knows which query answered what.
  const [
    receipts,
    verify,
    tagging,
    picklist,
    koli,
    shipments,
    dispatches,
    counts,
    owned,
  ] = useQueries({
    queries: [
      {
        queryKey: keys.receipts(),
        queryFn: () => dc.goodsReceipts(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.verifyQueue(),
        queryFn: () => dc.countsAwaitingVerification(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.taggingJobs(),
        queryFn: () => dc.taggingJobs(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.picklist(),
        queryFn: () => dc.picklist(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.koli(),
        queryFn: () => dc.koli(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.shipments({ unassigned: true }),
        queryFn: () => dc.shipments({ unassigned: true }),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.dispatches({ ready: true }),
        queryFn: () => dc.dispatches({ ready: true }),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.officialCounts(),
        queryFn: () => dc.officialCounts(),
        refetchInterval: QUEUE_POLL_MS,
      },
      {
        queryKey: keys.pools(),
        queryFn: () => poolsAnswer(),
        refetchInterval: QUEUE_POLL_MS,
      },
    ],
  })

  const lines = picklist.data ?? []
  const boxes = koli.data ?? []

  return {
    receipts: receipts.data?.length ?? 0,
    awaitingVerification: verify.data?.length ?? 0,
    tagging: tagging.data?.length ?? 0,
    picklistLines: lines.length,
    picklistUnits: lines.reduce((total, line) => total + line.outstanding, 0),
    unsealedKoli: boxes.filter((box) => box.sealed_at === null).length,
    // Sealed and unclaimed: the pile a supervisor builds a consignment from.
    loose: boxes.filter(
      (box) => box.sealed_at !== null && box.shipment_id === null
    ).length,
    unshipped: shipments.data?.length ?? 0,
    onYard: dispatches.data?.length ?? 0,
    // A count is the warehouse's business until it has been submitted; what
    // happens to it afterwards is decided at the centre.
    openCounts: (counts.data ?? []).filter(
      (count) => count.submitted_at === null
    ).length,
    // Leaves only. The rollups are sums of the pools under them, so counting
    // both would report every missing piece twice.
    missing: (owned.data?.items ?? [])
      .filter((pool) => pool.is_rollup === false)
      .reduce((total, pool) => total + pool.missing, 0),
  }
}

export { poolsAnswer }
