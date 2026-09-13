import { queryOptions } from "@tanstack/react-query"

import { dc, poolsAnswer, skuNames, sync } from "@/lib/api"
import type { ListFilter } from "@itulah/contract/client"

/// Every read this app makes, and the key it is cached under.
///
/// Written out here rather than composed at each call site, because **one action
/// on a floor moves the goods through several stations at once.** Sealing a
/// carton empties the packing queue, fills the shipping one and moves three
/// outbound pools. Accepting a count turns goods into stock, closes a line on
/// the bay list and creates a tagging job at a bench on the other side of the
/// building. A write that invalidates a key nobody is watching leaves a sealed
/// carton showing as open until somebody reloads their phone — and that is not a
/// bug anyone finds by reading the screen.
///
/// The first segment is the domain, so signing out can drop a whole surface by
/// prefix and `keys.dc.all` can be invalidated by an action that genuinely
/// touches everything.
export const keys = {
  /// Everything this node serves under `/api/v1/dc`. Invalidated whole by the
  /// outbound actions, which really do touch every list on their screen.
  dc: { all: ["dc"] as const },

  // ── Terima ───────────────────────────────────────────────────────────────
  receipts: () => ["dc", "goods-receipts"] as const,
  /// The counter's work list. Named for the job rather than for the route
  /// (`/dc/purchase-orders`), because it is deliberately not an order list.
  purchaseWork: () => ["dc", "purchase-work"] as const,
  verifyQueue: () => ["dc", "purchase-counts"] as const,

  // ── Tag ──────────────────────────────────────────────────────────────────
  taggingJobs: () => ["dc", "tagging-jobs"] as const,

  // ── Ambil ────────────────────────────────────────────────────────────────
  /// What is still owed, by SKU. Recomputed on every read — nobody authors it,
  /// which is why it is what a new round is composed against.
  picklist: () => ["dc", "picklist"] as const,
  picklists: () => ["dc", "picklists"] as const,
  pickRound: (sessionId: string) => ["dc", "pick-session", sessionId] as const,

  // ── Kemas ────────────────────────────────────────────────────────────────
  destinations: () => ["dc", "destinations"] as const,
  koli: (filter: ListFilter = {}) => ["dc", "koli", filter] as const,
  manifest: (koliId: string) => ["dc", "koli", koliId, "manifest"] as const,
  outstanding: (storeId: string) => ["dc", "outstanding", storeId] as const,

  // ── Kirim ────────────────────────────────────────────────────────────────
  shipments: (filter: ListFilter = {}) => ["dc", "shipments", filter] as const,
  shipment: (id: string) => ["dc", "shipment", id] as const,
  dispatches: (filter: ListFilter = {}) => ["dc", "dispatches", filter] as const,
  dispatch: (id: string) => ["dc", "dispatch", id] as const,

  // ── Opname ───────────────────────────────────────────────────────────────
  counts: () => ["dc", "official-counts"] as const,
  count: (id: string) => ["dc", "official-count", id] as const,

  // ── Stock, which every station moves ─────────────────────────────────────
  pools: () => ["inventory", "pools"] as const,
  /// Names for a set of SKUs. Keyed by the sorted set rather than by the list
  /// as given, so the picking screen and the packing screen asking for the same
  /// twelve codes in different orders is one request.
  names: (codes: readonly string[]) =>
    ["catalog", "identities", [...new Set(codes)].sort().join(",")] as const,

  // ── The node itself ──────────────────────────────────────────────────────
  syncStatus: () => ["node", "sync-status"] as const,
} as const

/// The reads themselves, as options a screen hands straight to `useQuery`.
///
/// A factory rather than a hook each: the work-list screen asks for eight of
/// these at once through `useQueries`, and a hook cannot be called in a loop.
export const reads = {
  purchaseWork: () =>
    queryOptions({
      queryKey: keys.purchaseWork(),
      queryFn: ({ signal }) => dc.purchaseWork(signal),
    }),
  receipts: () =>
    queryOptions({
      queryKey: keys.receipts(),
      queryFn: ({ signal }) => dc.goodsReceipts(signal),
    }),
  verifyQueue: () =>
    queryOptions({
      queryKey: keys.verifyQueue(),
      queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
    }),
  taggingJobs: () =>
    queryOptions({
      queryKey: keys.taggingJobs(),
      queryFn: ({ signal }) => dc.taggingJobs(signal),
    }),
  picklist: () =>
    queryOptions({
      queryKey: keys.picklist(),
      queryFn: ({ signal }) => dc.picklist(signal),
    }),
  picklists: () =>
    queryOptions({
      queryKey: keys.picklists(),
      queryFn: ({ signal }) => dc.picklists(signal),
    }),
  pickRound: (sessionId: string) =>
    queryOptions({
      queryKey: keys.pickRound(sessionId),
      queryFn: ({ signal }) => dc.pickSession(sessionId, signal),
    }),
  destinations: () =>
    queryOptions({
      queryKey: keys.destinations(),
      queryFn: ({ signal }) => dc.destinations(signal),
    }),
  koli: (filter: ListFilter = {}) =>
    queryOptions({
      queryKey: keys.koli(filter),
      queryFn: ({ signal }) => dc.koli(filter, signal),
    }),
  manifest: (koliId: string) =>
    queryOptions({
      queryKey: keys.manifest(koliId),
      queryFn: ({ signal }) => dc.koliManifest(koliId, signal),
    }),
  outstanding: (storeId: string) =>
    queryOptions({
      queryKey: keys.outstanding(storeId),
      queryFn: ({ signal }) => dc.outstandingFor(storeId, signal),
    }),
  shipments: (filter: ListFilter = {}) =>
    queryOptions({
      queryKey: keys.shipments(filter),
      queryFn: ({ signal }) => dc.shipments(filter, signal),
    }),
  dispatches: (filter: ListFilter = {}) =>
    queryOptions({
      queryKey: keys.dispatches(filter),
      queryFn: ({ signal }) => dc.dispatches(filter, signal),
    }),
  dispatch: (id: string) =>
    queryOptions({
      queryKey: keys.dispatch(id),
      queryFn: ({ signal }) => dc.dispatch(id, signal),
    }),
  counts: () =>
    queryOptions({
      queryKey: keys.counts(),
      queryFn: ({ signal }) => dc.officialCounts(signal),
    }),
  count: (id: string) =>
    queryOptions({
      queryKey: keys.count(id),
      queryFn: ({ signal }) => dc.officialCount(id, signal),
    }),
  pools: () =>
    queryOptions({
      queryKey: keys.pools(),
      queryFn: ({ signal }) => poolsAnswer(signal),
    }),
  /// Names are a property of the range rather than of the work, so they are held
  /// for an hour: a SKU does not get renamed while somebody walks a round, and
  /// re-asking on every list refresh would put a second request behind every
  /// poll of every station.
  names: (codes: readonly string[]) =>
    queryOptions({
      queryKey: keys.names(codes),
      queryFn: ({ signal }) => skuNames(codes, signal),
      enabled: codes.length > 0,
      staleTime: 60 * 60_000,
    }),
  syncStatus: () =>
    queryOptions({
      queryKey: keys.syncStatus(),
      queryFn: ({ signal }) => sync.status(signal),
    }),
} as const
