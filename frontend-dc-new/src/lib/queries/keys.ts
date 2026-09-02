import type { ListFilter } from "@itulah/contract/client"

/// Every cache key in the app, in one file.
///
/// The hub scatters keys across `queries/<domain>.ts` because its nine modules
/// are written by nine hands and rarely invalidate each other. A warehouse is
/// the opposite: **one action moves the goods through several stations at
/// once.** Sealing a carton empties the packing queue, fills the shipping one
/// and moves three outbound pools. Packing a box shortens what a store is owed
/// and closes an allotment line somebody is watching on another screen.
///
/// Written out here rather than composed at each call site, because a mutation
/// that invalidates a key nobody is watching leaves a sealed carton showing as
/// open until somebody reloads the tablet — and that is not a bug anyone finds
/// by reading the screen.
///
/// The first segment is the domain, so sign-out can drop a whole surface by
/// prefix and `dc.all` can be invalidated by an action that genuinely touches
/// everything.
export const keys = {
  /// Everything this node serves under `/api/v1/dc`. Invalidated whole by the
  /// outbound actions, which really do touch every list on their screen.
  dc: { all: ["dc"] as const },

  // ── Intake ───────────────────────────────────────────────────────────────
  receipts: () => ["dc", "goods-receipts"] as const,
  /// The checker's work list. Named for the job rather than for the route
  /// (`/dc/purchase-orders`), because it is deliberately not an order list —
  /// it carries no ordered quantity at all.
  purchaseWork: () => ["dc", "purchase-work"] as const,
  verifyQueue: () => ["dc", "purchase-counts"] as const,

  // ── Tagging ──────────────────────────────────────────────────────────────
  taggingJobs: () => ["dc", "tagging-jobs"] as const,
  /// Keyed by the **job**, not by the session: a job is given exactly one run
  /// and the server refuses a second, so a screen that reloaded knows only
  /// which job it was printing.
  jobRun: (jobId: string) => ["dc", "tagging-job", jobId, "run"] as const,
  run: (sessionId: string) => ["dc", "print-session", sessionId] as const,
  /// One drawn label. The stock and the colourway are in the key because they
  /// are what the picture is OF — change either and it is a different label,
  /// not a stale one, so it must not be served from the cache of the last.
  labelPreview: (
    jobId: string,
    widthMm: number,
    heightMm: number,
    skuCode: string | undefined,
    language: string
  ) =>
    [
      "dc",
      "tagging-job",
      jobId,
      "label-preview",
      widthMm,
      heightMm,
      skuCode ?? "first",
      language,
    ] as const,

  // ── Counting ─────────────────────────────────────────────────────────────
  counts: () => ["dc", "official-counts"] as const,
  count: (countId: string) => ["dc", "official-count", countId] as const,

  // ── Picking ──────────────────────────────────────────────────────────────
  picklist: () => ["dc", "picklist"] as const,
  pickRounds: (filter: ListFilter = {}) =>
    ["dc", "pick-sessions", filter] as const,
  pickRound: (sessionId: string) => ["dc", "pick-session", sessionId] as const,
  /// One allotment line's position, counted from containment.
  linePosition: (lineId: string) =>
    ["dc", "allotment-line", lineId, "position"] as const,

  // ── Packing ──────────────────────────────────────────────────────────────
  packRounds: (filter: ListFilter = {}) =>
    ["dc", "packing-sessions", filter] as const,
  packRound: (sessionId: string) =>
    ["dc", "packing-session", sessionId] as const,
  /// The RFID box being filled against a target, which is a different thing
  /// from the packing round it may or may not belong to.
  packingBox: (sessionId: string) => ["dc", "packing-box", sessionId] as const,
  koli: (filter: ListFilter = {}) => ["dc", "koli", filter] as const,
  manifest: (koliId: string) => ["dc", "koli", koliId, "manifest"] as const,
  outstanding: (storeId: string) => ["dc", "outstanding", storeId] as const,

  // ── Despatch ─────────────────────────────────────────────────────────────
  shipments: (filter: ListFilter = {}) => ["dc", "shipments", filter] as const,
  shipment: (id: string) => ["dc", "shipment", id] as const,
  dispatches: (filter: ListFilter = {}) =>
    ["dc", "dispatches", filter] as const,
  dispatch: (id: string) => ["dc", "dispatch", id] as const,

  // ── Stock, which every station moves ─────────────────────────────────────
  pools: () => ["inventory", "pools"] as const,
  movements: (limit: number) => ["inventory", "movements", limit] as const,

  // ── The node itself ──────────────────────────────────────────────────────
  syncStatus: () => ["node", "sync-status"] as const,
} as const
