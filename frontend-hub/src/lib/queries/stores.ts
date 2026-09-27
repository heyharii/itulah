import { node } from "@/lib/api"
import type {
  OpenedStore,
  OpenStoreRequest,
  StoreCheck,
  StoreDetail,
  StoreList,
  StorePic,
  StoreReadiness,
  StoreServer,
  StoreServerInstall,
  StoreSummary,
  StoreTills,
  TestPrintRequested,
} from "@itulah/contract"

export type {
  OpenedStore,
  OpenStoreRequest,
  StoreCheck,
  StoreDetail,
  StoreList,
  StorePic,
  StoreReadiness,
  StoreServer,
  StoreServerInstall,
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
  flowNotices: (open: boolean) => ["stores", "flow-notices", open] as const,
}

/// Every store within the caller's reach, and whether they may manage any of
/// them (`can_manage` — an Admin at head office; open new stores, install a
/// server). The list itself is already narrowed to reach by the server, so a
/// store's manager simply never sees another store's row here.
export function listStores(signal?: AbortSignal): Promise<StoreList> {
  return node.get<StoreList>("/api/v1/stores", { signal })
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
  body: OpenStoreRequest
): Promise<OpenedStore> {
  return node.post<OpenedStore>(
    `/api/v1/stores/${encodeURIComponent(unit)}/open`,
    body
  )
}

/// Issue an install code and QR for this store's server. A store that already
/// has one outstanding gets a new one — the new code cancels the old, same as
/// `issueEnrolment` on System › Nodes. Answers 201; `response.ok` covers that
/// the same as 200, so nothing here has to name the status.
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
// Gudang already reads locally. There is no cloud endpoint's *generated*
// contract for this yet — swap this for `@itulah/contract` the day one
// exists. The Stock tab asks the hub's own copy of the same shape, filtered
// here to the documents that name this store's site at either end, since
// there is no site parameter to ask the server for on this endpoint.

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
