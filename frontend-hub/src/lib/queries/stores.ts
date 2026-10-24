import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  OpenedStore,
  OpenStoreRequest,
  PosStopNote,
  PosStopRequest,
  RemoveStoreRequest,
  StoreCheck,
  StoreDetail,
  StoreList,
  StorePic,
  StorePos,
  StorePosCashier,
  StorePosShift,
  StorePosTill,
  StoreReadiness,
  StoreServer,
  StoreServerInstall,
  StoreStop,
  StoreSummary,
  StoreTills,
  TestPrintRequested,
} from "@itulah/contract"

export type {
  OpenedStore,
  OpenStoreRequest,
  PosStopNote,
  PosStopRequest,
  RemoveStoreRequest,
  StoreCheck,
  StoreDetail,
  StoreList,
  StorePic,
  StorePos,
  StorePosCashier,
  StorePosShift,
  StorePosTill,
  StoreReadiness,
  StoreServer,
  StoreServerInstall,
  StoreStop,
  StoreSummary,
  StoreTills,
  TestPrintRequested,
}

/// Stores — the hub's own page for opening a shop and watching it once it is
/// trading.
///
/// # Why this is not read off `organisation.ts` and `system.ts` alone
///
/// Everything a store needs already has a screen: the node register, the
/// enrolment queue, the workforce, the shop's payment methods, the facilities
/// hub. Opening a store is not a new kind of data — it is a single READING of
/// all of that, one store at a time, plus the one decision ("is this store
/// ready to sell") none of those screens can answer on its own because each
/// only sees its own slice. `/api/v1/stores` is that reading, done once on the
/// server rather than stitched together in five queries per row.
///
/// `Store*`, `OpenedStore` and `TestPrintRequested` are generated —
/// `backend/src/cloud/http/stores.rs`, on `handheld-rfid`. `FlowNotice` below
/// is not: there is no cloud endpoint's contract for it yet, only the edge
/// node's own (`backend/src/edge/flows.rs`), so it stays hand-transcribed with
/// its own TODO.

/// `StoreSummary.status` and `StoreServer.state` come back as plain `string`
/// — ts-rs carries a Rust enum's SHAPE across, not its variants, so the
/// closed set each is drawn from lives here by hand, purely as the keys the
/// label and tone maps below are indexed by. A value is cast into one of
/// these only once it has actually been read off the field it names.
///
/// `STOPPED` is head office's stop (0990): the tills do not sell until it
/// resumes the store. `CLOSED` is a store head office removed for good; the
/// hub says "Removed".
export type StoreStatus = "GETTING_READY" | "OPEN" | "STOPPED" | "CLOSED"

/// What each word is called on screen lives in `screens/stores/shared.tsx`:
/// `SYNCING` is "Getting data" and `ONLINE` is "Ready". `WAITING_FOR_APPROVAL`
/// no longer happens in the normal flow — a claimed code is approved by itself
/// — and stays only as a fallback.
export type ServerState =
  | "NOT_INSTALLED"
  | "WAITING_TO_INSTALL"
  | "WAITING_FOR_APPROVAL"
  | "SYNCING"
  | "ONLINE"
  | "OFFLINE"

/// What the store's server adds to `StoreServer` once it has connected
/// (`machine`, `connected_at`, `first_data`, `app_address`, `app_qr_svg`).
/// Declared here by hand, all optional, so the screens read them through
/// `serverExtras` and degrade to nothing while the generated contract has not
/// caught up — the day it has, this is the same shape and can be dropped.
export interface ServerMachine {
  readonly hostname: string
  readonly os: string
  readonly version: string
}

/// One stream of the first data a new server pulls — articles, price books,
/// staff, payment methods, promotions.
export interface FirstDataStream {
  readonly key: string
  readonly label: string
  readonly done: boolean
  readonly count: number | null
}

/// Present while the server is `SYNCING`.
export interface FirstData {
  readonly done: number
  readonly total: number
  readonly streams: readonly FirstDataStream[]
}

export interface ServerExtras {
  readonly machine: ServerMachine | null
  /// ISO.
  readonly connected_at: string | null
  readonly first_data: FirstData | null
  /// Where the store app is served on the shop's network.
  readonly app_address: string | null
  /// An inline `<svg>` QR of `app_address`; draw it with `svgDataUri`.
  readonly app_qr_svg: string | null
}

export function serverExtras(
  server: StoreServer
): StoreServer & Partial<ServerExtras> {
  return server as StoreServer & Partial<ServerExtras>
}

/// A server state that is on its way somewhere else, rather than at rest.
/// What the Server tab polls every 5 seconds for, and nothing else does.
export function isTransitionalServerState(state: string): boolean {
  return (
    state === "WAITING_TO_INSTALL" ||
    state === "WAITING_FOR_APPROVAL" ||
    state === "SYNCING"
  )
}

export const storesKeys = {
  all: ["stores"] as const,
  list: () => ["stores", "list"] as const,
  detail: (unit: string) => ["stores", "detail", unit] as const,
  pos: (unit: string) => ["stores", "pos", unit] as const,
  flowNotices: (open: boolean) => ["stores", "flow-notices", open] as const,
}

/// Every store within the caller's reach, and whether they may manage any of
/// them (`can_manage` — an Admin at head office; open new stores, install a
/// server). The list itself is already narrowed to reach by the server, so a
/// store's manager simply never sees another store's row here.
export function listStores(signal?: AbortSignal): Promise<StoreList> {
  return node.get<StoreList>("/api/v1/stores", { signal })
}

/// Every store, as the Stores list reads it and the prefetcher asks for it
/// (`screens/stores/prefetch.ts`). A server's heartbeat and a till's last-seen
/// move by the second; a shop watched from this list should not look five
/// minutes stale.
export const storesListQuery = () =>
  queryOptions({
    queryKey: storesKeys.list(),
    queryFn: ({ signal }) => listStores(signal),
    refetchInterval: 30_000,
  })

export function storeDetail(
  unit: string,
  signal?: AbortSignal
): Promise<StoreDetail> {
  return node.get<StoreDetail>(`/api/v1/stores/${encodeURIComponent(unit)}`, {
    signal,
  })
}

/// The store's Tills tab: each till with its machine, shift and stop, and each
/// person who signs in at its tills with head office's stop on them
/// (`can_manage`: an Admin at head office may stop, resume and remove).
export function storePos(
  unit: string,
  signal?: AbortSignal
): Promise<StorePos> {
  return node.get<StorePos>(`/api/v1/stores/${encodeURIComponent(unit)}/pos`, {
    signal,
  })
}

/// Stop the whole store: its tills stop selling, and an open drawer can only
/// be closed. The server, the store app and the sync go on. `reason` is
/// required — the till shows it. Answers the store, now `STOPPED`.
export function stopStore(
  unit: string,
  body: PosStopRequest
): Promise<StoreDetail> {
  return node.post<StoreDetail>(
    `/api/v1/stores/${encodeURIComponent(unit)}/stop`,
    body
  )
}

/// Let a stopped store sell again. Answers the store, `OPEN` once more.
export function resumeStore(unit: string): Promise<StoreDetail> {
  return node.post<StoreDetail>(
    `/api/v1/stores/${encodeURIComponent(unit)}/resume`,
    {}
  )
}

/// Remove a store that has closed for good — a stopped store, with no drawer
/// open, whose code is typed back. Its sales, stock and journals stay; its
/// server stays connected and keeps sending what it holds, so a sale not yet
/// sent still arrives. Answers the store, now `CLOSED`.
export function removeStore(
  unit: string,
  body: RemoveStoreRequest
): Promise<StoreDetail> {
  return node.post<StoreDetail>(
    `/api/v1/stores/${encodeURIComponent(unit)}/remove`,
    body
  )
}

/// Stop one person on the POS, at every store. Answers the Tills tab.
export function stopCashier(
  unit: string,
  userId: string,
  body: PosStopRequest
): Promise<StorePos> {
  return node.post<StorePos>(
    `/api/v1/stores/${encodeURIComponent(unit)}/cashiers/${encodeURIComponent(userId)}/stop`,
    body
  )
}

/// Let a stopped person sign in at the tills again. Answers the Tills tab.
export function resumeCashier(
  unit: string,
  userId: string
): Promise<StorePos> {
  return node.post<StorePos>(
    `/api/v1/stores/${encodeURIComponent(unit)}/cashiers/${encodeURIComponent(userId)}/resume`,
    {}
  )
}

/// Open the store for trading. `note` is kept beside the decision, not asked
/// for — most stores need nothing said about it.
///
/// The server refuses with 409 and a sentence naming every unmet check when
/// `can_open` is not yet true; that sentence is what this app shows, verbatim,
/// rather than re-deriving its own from the checklist.
export function openStore(
  unit: string,
  body: OpenStoreRequest
): Promise<OpenedStore> {
  return node.post<OpenedStore>(
    `/api/v1/stores/${encodeURIComponent(unit)}/open`,
    body
  )
}

/// Set how many till seats the store has — Till 1 to Till N (1..50, Admin
/// only). A seat is the store's to have, decided here; a machine at the shop
/// sits at one and never adds one. Answers the whole updated store, so the
/// caller can put it straight into the detail cache.
///
/// Fewer seats never ends a shift: a drawer still open at a removed seat stays
/// listed at the shop until it is closed. The server refuses (409) a store
/// with no premises yet.
export function setTillSeats(
  unit: string,
  count: number
): Promise<StoreDetail> {
  return node.put<StoreDetail>(
    `/api/v1/stores/${encodeURIComponent(unit)}/tills`,
    { count }
  )
}

/// Issue an install code for this store's server — good for one hour, once. A
/// store that already has one outstanding gets a new one — the new code
/// cancels the old, same as `issueEnrolment` on System › Nodes. Answers 201; `response.ok` covers that
/// the same as 200, so nothing here has to name the status.
export function installStoreServer(unit: string): Promise<StoreServerInstall> {
  return node.post<StoreServerInstall>(
    `/api/v1/stores/${encodeURIComponent(unit)}/server/install`,
    {}
  )
}

/// Disconnect the machine that is serving this store: the server stops
/// receiving the store's data and a fresh install code is issued for the right
/// machine. Admin only; answers like `installStoreServer`. A removed store's
/// server is let go for good: no code comes back (`204`, `undefined`).
export function disconnectStoreServer(
  unit: string
): Promise<StoreServerInstall | undefined> {
  return node.post<StoreServerInstall | undefined>(
    `/api/v1/stores/${encodeURIComponent(unit)}/server/disconnect`,
    {}
  )
}

/// Install codes issued in this browser tab, by unit id. A code is shown once
/// and no read of the store returns it again, so the page that issued it
/// hands it to the Server tab through here — the "Add store" sheet issues one
/// right after the store is made, and the store page then shows it at once.
/// Held in memory only and never persisted: a reload loses it, which is the
/// rule for a write-once secret.
const heldInstalls = new Map<string, StoreServerInstall>()

export function holdInstall(unit: string, install: StoreServerInstall): void {
  heldInstalls.set(unit, install)
}

/// The held code, unless it has run out (a code lives for an hour).
export function heldInstallOf(unit: string): StoreServerInstall | null {
  const held = heldInstalls.get(unit)
  if (held === undefined) return null
  if (Date.parse(held.expires_at) <= Date.now()) {
    heldInstalls.delete(unit)
    return null
  }
  return held
}

export function dropHeldInstall(unit: string): void {
  heldInstalls.delete(unit)
}

/// A `data:` URI an `<img>` can point at, built from the server's inline SVG
/// text rather than injected into the DOM.
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/// Ask a till or printer to print its test page. The answer (202) is only
/// that the node was asked; whether it actually printed arrives later on the
/// device's own register row as `last_test_print_at`/`last_test_print_ok`
/// (see `RegistryDevice` in `lib/queries/system.ts`).
export function testPrint(deviceId: string): Promise<TestPrintRequested> {
  return node.post<TestPrintRequested>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/test-print`,
    {}
  )
}

// ---- Flow notices: goods documents touching a site ------------------------
//
// TODO: transcribed by hand from the edge node's own `FlowNotice`/
// `FlowNoticeList` (`backend/src/edge/flows.rs`), which is what a shop or the
// warehouse already reads locally. There is no cloud endpoint's *generated*
// contract for this yet — swap this for `@itulah/contract` the day one
// exists. The Stock tab asks the hub's own copy of the same shape, filtered
// here to the documents that name this store's site at either end, since
// there is no site parameter to ask the server for on this endpoint.

export type FlowNoticeStatus =
  "REQUESTED" | "CONFIRMED" | "COMPLETED" | "DECLINED" | "CANCELED"

export interface FlowNoticeEvent {
  readonly event_id: number
  readonly stage_kind: string | null
  readonly event_type: string
  readonly executed_at: string
  readonly created_at: string
}

export interface FlowNotice {
  readonly document_id: string
  readonly document_number: string
  readonly template_code: string
  readonly template_name: string
  readonly source_kind: string
  readonly source_id: string
  readonly origin_site_id: string | null
  readonly destination_site_id: string | null
  readonly destination_party_kind: string | null
  readonly status: FlowNoticeStatus
  readonly current_stage: string | null
  readonly updated_at: string
  readonly events: readonly FlowNoticeEvent[]
}

/// `open`: only documents still running (`REQUESTED`/`CONFIRMED`).
export function listFlowNotices(
  open: boolean,
  signal?: AbortSignal
): Promise<FlowNotice[]> {
  return node
    .get<{ documents: FlowNotice[] }>(`/api/v1/flow-notices?open=${open}`, {
      signal,
    })
    .then((body) => body.documents)
}

/// The open documents that name this site, either end.
export function flowNoticesForSite(
  notices: readonly FlowNotice[],
  siteId: string
): FlowNotice[] {
  return notices.filter(
    (notice) =>
      notice.origin_site_id === siteId || notice.destination_site_id === siteId
  )
}
