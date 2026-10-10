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
  /// What the badge and the order book read off that list, without it. Under
  /// `purchaseWork` so whatever refreshes the list refreshes this with it.
  purchaseSummary: () => ["dc", "purchase-work", "summary"] as const,
  /// The uploaded invoice page for one delivery. Keyed by the delivery and not
  /// by the count: one lorry brings one invoice, and every count on it looks
  /// at the same page.
  invoiceDocument: (receiptId: string) =>
    ["dc", "goods-receipt", receiptId, "invoice-document"] as const,
  verifyQueue: () => ["dc", "purchase-counts"] as const,
  /// Excess beyond a PO, waiting for this node to hand it to the supplier.
  purchaseReturns: () => ["dc", "purchase-returns"] as const,

  // ── Intake: a store's return, received blind and then inspected ─────────
  storeInbound: (status?: string) =>
    ["dc", "store-inbound", status ?? "ALL"] as const,
  storeInboundDetail: (deliveryId: string) =>
    ["dc", "store-inbound", "delivery", deliveryId] as const,
  returnInspections: () => ["dc", "return-inspections"] as const,
  /// Which supplier each SKU's goods came from, for one set of codes.
  skuSuppliers: (skus: readonly string[]) =>
    ["inventory", "sku-suppliers", skus] as const,
  returnInspection: (deliveryId: string) =>
    ["dc", "return-inspections", deliveryId] as const,

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
    offsetMm: number,
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
      offsetMm,
      skuCode ?? "first",
      language,
    ] as const,
  // ── Picking ──────────────────────────────────────────────────────────────
  /// What is still owed, by SKU. Recomputed on every read — nobody authors it,
  /// which is why it is what a new picklist is composed against.
  picklist: () => ["dc", "picklist"] as const,
  /// The picklists themselves: rounds that have been walked.
  picklists: () => ["dc", "picklists"] as const,
  /// Every picklist still to pick, one per allotment × shop (owner, 29 Sep
  /// 2026: nobody composes one — it exists as soon as the allotment is
  /// here) — the Picking screen's "To pick" card.
  picklistsToPick: () => ["dc", "picklists-to-pick"] as const,
  pickRound: (sessionId: string) => ["dc", "pick-session", sessionId] as const,
  /// Work MD left the Gudang to undo: pieces in the pick area and in unsent
  /// cartons that MD edited or cancelled away (`GET /api/v1/dc/owed`). The
  /// board's red strips and CANCELLED stamps, and what Move back prefills.
  owed: () => ["dc", "owed"] as const,
  /// Pickers who could not finish a line, and why (`GET /api/v1/dc/short-picks`):
  /// the amber Short pick strip on a To pick card.
  shortPicks: () => ["dc", "short-picks"] as const,
  /// MD changes the warehouse has not acknowledged yet (`GET /api/v1/dc/changes`):
  /// the board's tags and "Got it", and the picker's banner.
  changes: () => ["dc", "changes"] as const,

  // ── Packing ──────────────────────────────────────────────────────────────
  /// Every shop with something outstanding — the packer's queue.
  destinations: () => ["dc", "destinations"] as const,
  koli: (filter: ListFilter = {}) => ["dc", "koli", filter] as const,
  /// Boxes opened against a target and still waiting for their RFID sweep.
  packingBoxes: () => ["dc", "packing-boxes"] as const,
  /// The reading sessions the node has heard from, newest first.
  rfidSessions: () => ["dc", "rfid-sessions"] as const,
  manifest: (koliId: string) => ["dc", "koli", koliId, "manifest"] as const,
  outstanding: (storeId: string) => ["dc", "outstanding", storeId] as const,

  // ── Despatch ─────────────────────────────────────────────────────────────
  shipments: (filter: ListFilter = {}) => ["dc", "shipments", filter] as const,
  shipment: (id: string) => ["dc", "shipment", id] as const,
  dispatches: (filter: ListFilter = {}) =>
    ["dc", "dispatches", filter] as const,
  dispatch: (id: string) => ["dc", "dispatch", id] as const,
  /// Surat jalan the shops have received — read from the centre, so it sits
  /// outside `dc` and a DC action does not refetch it.
  receivedShipments: (since: string) =>
    ["inventory", "shipments-received", since] as const,

  // ── Stock, which every station moves ─────────────────────────────────────
  pools: () => ["inventory", "pools"] as const,

  // ── The node itself ──────────────────────────────────────────────────────
  syncStatus: () => ["node", "sync-status"] as const,
} as const
