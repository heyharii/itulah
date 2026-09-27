import { node } from "@/lib/api"

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
/// # TODO
///
/// These types are transcribed by hand against the shapes the backend agent
/// is building alongside this screen (see the Stores backend branch). Swap
/// them for `@itulah/contract` once that package exports
/// `StoreSummary`/`StoreDetail`/`FlowNotice` — nothing below is generated.

export type StoreStatus = "GETTING_READY" | "OPEN" | "CLOSED"

export type ServerState =
  | "NOT_INSTALLED"
  | "WAITING_TO_INSTALL"
  | "WAITING_FOR_APPROVAL"
  | "SYNCING"
  | "ONLINE"
  | "OFFLINE"

/// A server state that is on its way somewhere else, rather than at rest.
/// What the Server tab polls every 5 seconds for, and nothing else does.
export function isTransitionalServerState(state: ServerState): boolean {
  return (
    state === "WAITING_TO_INSTALL" ||
    state === "WAITING_FOR_APPROVAL" ||
    state === "SYNCING"
  )
}

export interface StorePic {
  readonly employee_id: string
  readonly name: string
}

export interface StoreReadiness {
  readonly done: number
  readonly total: number
}

export interface StoreServerStatus {
  readonly state: ServerState
  readonly last_seen_at: string | null
  /// The enrolment this server's install code was issued as, while one is
  /// outstanding or waiting for approval. `null` once nothing is pending —
  /// including once the server is online.
  readonly enrolment_id: string | null
}

export interface StoreTillsStatus {
  readonly active: number
  readonly online: number
  readonly waiting: number
}

export interface StoreSummary {
  readonly unit_id: string
  readonly code: string
  readonly name: string
  readonly status: StoreStatus
  readonly opened_at: string | null
  readonly site_id: string
  readonly site_code: string
  readonly city: string
  readonly timezone: string
  readonly pic: StorePic | null
  readonly readiness: StoreReadiness
  readonly server: StoreServerStatus
  readonly tills: StoreTillsStatus
}

export type StoreCheckKey =
  | "server"
  | "tills"
  | "team"
  | "payments"
  | "first_stock"

export interface StoreCheck {
  readonly key: StoreCheckKey
  readonly ok: boolean
  readonly required: boolean
  readonly title: string
  readonly detail: string | null
}

export interface StoreDetail {
  readonly store: StoreSummary
  readonly address: string | null
  readonly checks: readonly StoreCheck[]
  readonly can_open: boolean
}

export interface OpenStoreResult {
  readonly unit_id: string
  readonly opened_at: string
  readonly opened_by: string
}

/// What issuing an install code for a store's server hands back. Same shape
/// as `IssuedEnrolment` (`lib/queries/system.ts`) plus the QR this endpoint
/// draws for the store, since a person standing at the server has no keyboard
/// worth typing six characters on.
export interface StoreServerInstall {
  readonly enrolment_id: string
  readonly code: string
  readonly expires_at: string
  readonly installer_url: string
  /// An inline `<svg>…</svg>` string. Never dropped in with
  /// `dangerouslySetInnerHTML` — built into a `data:image/svg+xml` URI and
  /// handed to an `<img>` instead, so a byte this app did not draw is never
  /// parsed as markup on the page. See `svgDataUri` below.
  readonly qr_svg: string
}

export interface TestPrintResult {
  readonly request_id: string
}

export const storesKeys = {
  all: ["stores"] as const,
  list: () => ["stores", "list"] as const,
  detail: (unit: string) => ["stores", "detail", unit] as const,
  flowNotices: (open: boolean) => ["stores", "flow-notices", open] as const,
}

export function listStores(signal?: AbortSignal): Promise<StoreSummary[]> {
  return node
    .get<{ items: StoreSummary[] }>("/api/v1/stores", { signal })
    .then((body) => body.items)
}

export function storeDetail(
  unit: string,
  signal?: AbortSignal
): Promise<StoreDetail> {
  return node.get<StoreDetail>(`/api/v1/stores/${encodeURIComponent(unit)}`, {
    signal,
  })
}

/// Open the store for trading. `note` is kept beside the decision, not asked
/// for — most stores need nothing said about it.
///
/// The server refuses with 409 and a sentence naming every unmet check when
/// `can_open` is not yet true; that sentence is what this app shows, verbatim,
/// rather than re-deriving its own from the checklist.
export function openStore(
  unit: string,
  body: { readonly note?: string }
): Promise<OpenStoreResult> {
  return node.post<OpenStoreResult>(
    `/api/v1/stores/${encodeURIComponent(unit)}/open`,
    body
  )
}

/// Issue an install code and QR for this store's server. A store that already
/// has one outstanding gets a new one — the new code cancels the old, same as
/// `issueEnrolment` on System › Nodes.
export function installStoreServer(
  unit: string
): Promise<StoreServerInstall> {
  return node.post<StoreServerInstall>(
    `/api/v1/stores/${encodeURIComponent(unit)}/server/install`,
    {}
  )
}

/// A `data:` URI an `<img>` can point at, built from the server's inline SVG
/// text rather than injected into the DOM.
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/// Ask a till or printer to print its test page. The answer is only that the
/// node was asked (202) — whether it actually printed arrives later on the
/// device's own register row as `last_test_print_at`/`last_test_print_ok`
/// (see `RegistryDevice` in `lib/queries/system.ts`).
export function testPrint(deviceId: string): Promise<TestPrintResult> {
  return node.post<TestPrintResult>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/test-print`,
    {}
  )
}

// ---- Flow notices: goods documents touching a site ------------------------
//
// Transcribed from the edge node's own `FlowNotice`/`FlowNoticeList`
// (`backend/src/edge/flows.rs`), which is what a shop or the Gudang already
// reads locally. The Stock tab asks the hub's own copy of the same shape,
// filtered here to the documents that name this store's site at either end —
// there is no site parameter to ask the server for on this endpoint yet.

export type FlowNoticeStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "COMPLETED"
  | "DECLINED"
  | "CANCELED"

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
