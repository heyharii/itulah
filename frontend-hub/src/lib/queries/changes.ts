import type { ChangeKind, ChangeStatus, PriceChange } from "@itulah/contract"
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Pricing changes — the work queue behind the prices.
///
/// Kept in its own module rather than added to `queries/commercial.ts` for the
/// same reason each screen module owns its own registry: this repository is
/// edited by several sessions at once, and a thousand-line shared file is where
/// two of them collide.
///
/// ## Two dimensions, never one
///
/// `status` is the business period and `rollout` is what the shops have
/// actually done — UI-001 §6 forbids collapsing them into a single lifecycle
/// enum, and the reason is concrete: a markdown whose period closed on the 30th
/// with two shops that never activated it is FINISHED as a decision and
/// UNFINISHED as work. One enum has to lie about one of those.

export type { ChangeKind, ChangeStatus, PriceChange }

/// What the list is filtered to, which is a question about WORK and not about
/// the calendar.
///
///   * **All** — everything still outstanding, plus, when asked, the settled.
///   * **Scheduled** — cut, dated, not started.
///   * **Active** — running now.
///   * **Attention** — a shop has failed, or the window has closed with shops
///     still outstanding. The queue somebody actually works.
export type ChangeLens = "ALL" | "SCHEDULED" | "ACTIVE" | "ATTENTION"

export const changeKeys = {
  all: ["commercial", "price-changes"] as const,
  /// `include_settled` is part of the key because it is a different question
  /// with a different answer, not a client-side narrowing of one list.
  list: (includeSettled: boolean) =>
    ["commercial", "price-changes", { includeSettled }] as const,
}

export function listPriceChanges(
  includeSettled: boolean,
  signal?: AbortSignal
): Promise<PriceChange[]> {
  const params = new URLSearchParams()
  if (includeSettled) params.set("include_settled", "true")
  const query = params.toString()
  return node
    .get<{ rows: PriceChange[] }>(
      `/api/v1/commercial/price-changes${query ? `?${query}` : ""}`,
      { signal }
    )
    .then((body) => body.rows)
}

/// The list as a query, for the Changes screen (and the Pricelist's tab of it)
/// and for the prefetcher (`screens/commercial/prefetch.ts`).
export const priceChangesQuery = (includeSettled: boolean) =>
  queryOptions({
    queryKey: changeKeys.list(includeSettled),
    queryFn: ({ signal }) => listPriceChanges(includeSettled, signal),
  })

/// Whether this change is somebody's problem right now.
///
/// A failure is always attention. A window that has closed while shops are
/// still outstanding is too — that is the case UI-001 §6 names explicitly:
/// "period berakhir tidak otomatis menyelesaikan pending activation work". An
/// open window with pending shops is not: the rollout is simply in progress,
/// which is what a rollout looks like.
export function needsAttention(change: PriceChange): boolean {
  if (change.rollout.failed > 0) return true
  return change.status === "ENDED" && change.rollout.pending > 0
}

/// The four kinds, in the client's words.
///
/// `UNCLASSIFIED` is a book cut before `change_type` existed (migration 0182)
/// and is shown as what it is rather than guessed at from the book's name — a
/// book called "Q3 Clearance" carrying base prices is a re-price.
export function describeChangeKind(kind: ChangeKind): string {
  switch (kind) {
    case "REGULAR_PRICE":
      return "Regular price change"
    case "MARKDOWN":
      return "Markdown"
    case "CLEARANCE":
      return "Clearance"
    case "CORRECTION":
      return "Correction"
    default:
      return "Unclassified"
  }
}

export function describeChangeStatus(status: ChangeStatus): string {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled"
    case "ACTIVE":
      return "Active"
    default:
      return "Ended"
  }
}

// ── the log ────────────────────────────────────────────────────────────────

/// One thing that happened to a price book.
///
/// Five kinds and not one, because UI-001 §7 forbids collapsing them: a
/// publication is not evidence that a till is charging anything, and a log that
/// said only "the book changed" would let a reader conclude it was.
export type PriceEventKind =
  "PUBLISHED" | "SENT" | "ACTIVATED" | "FAILED" | "EXPIRED"

export interface PriceEvent {
  readonly id: string
  readonly kind: PriceEventKind | string
  /// On the clock the event belongs to — for `ACTIVATED` that is the shop's
  /// own, not the centre's arrival time.
  readonly at: string
  readonly publication_id: string
  readonly version: number
  readonly publication_name: string
  readonly change_type: string | null
  /// Absent on `PUBLISHED` and `EXPIRED`: those are facts about the book, not
  /// about any branch.
  readonly site_id: string | null
  readonly actor: string | null
  /// The shop's own words when it could not apply a book. `FAILED` only.
  readonly detail: string | null
  /// How much of the book the shop took. `ACTIVATED` only.
  readonly price_rule_count: number | null
}

export const eventKeys = {
  all: ["commercial", "price-events"] as const,
  list: (version: number | null, siteId: string | null) =>
    ["commercial", "price-events", version, siteId] as const,
  /// The paged log, under the same prefix so an invalidation of `all` still
  /// reaches it, and with its own tail so no plain `useQuery` of one scope
  /// reads a paged answer as a list.
  pages: (siteId: string | null, kinds: readonly string[]) =>
    ["commercial", "price-events", "pages", siteId, kinds.join(",")] as const,
}

export function listPriceEvents(
  version: number | null,
  siteId: string | null,
  limit = 200,
  signal?: AbortSignal
): Promise<PriceEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (version !== null) params.set("version", String(version))
  if (siteId !== null) params.set("site_id", siteId)
  return node
    .get<{ rows: PriceEvent[] }>(
      `/api/v1/commercial/price-events?${params.toString()}`,
      { signal }
    )
    .then((body) => body.rows)
}

/// One page of the log, and where the next starts.
///
/// `rows` is the name the unpaged log answered with — `listPriceEvents` above
/// reads the first page and is still exactly what it was.
export interface PriceEventPage {
  readonly rows: PriceEvent[]
  /// Opaque. Absent means this was the last page.
  readonly next_cursor: string | null
}

export interface PriceEventScope {
  readonly version?: number | null
  readonly siteId?: string | null
  /// Kinds to keep; empty or absent is every kind. Narrowed by the server, so
  /// a lens over a paged log is a lens over the whole log.
  readonly kinds?: readonly PriceEventKind[]
  readonly cursor?: string
  readonly limit?: number
}

/// The log a page at a time, for an infinite list. Newest first, on a keyset
/// the server issues — the cursor is passed back verbatim.
export function priceEventPage(
  scope: PriceEventScope,
  signal?: AbortSignal
): Promise<PriceEventPage> {
  const params = new URLSearchParams({ limit: String(scope.limit ?? 100) })
  if (scope.version !== undefined && scope.version !== null)
    params.set("version", String(scope.version))
  if (scope.siteId !== undefined && scope.siteId !== null)
    params.set("site_id", scope.siteId)
  if (scope.kinds !== undefined && scope.kinds.length > 0)
    params.set("kind", scope.kinds.join(","))
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  return node.get<PriceEventPage>(
    `/api/v1/commercial/price-events?${params.toString()}`,
    { signal }
  )
}

/// How many events one page of the History log asks for.
export const LOG_PAGE = 150

/// The History log, a page at a time, narrowed by shop and kind. Shared by the
/// screen and its prefetcher (`screens/commercial/prefetch.ts`) so the key and
/// the request cannot drift apart.
export const priceEventPagesQuery = (
  siteId: string | null,
  kinds: readonly PriceEventKind[]
) =>
  infiniteQueryOptions({
    queryKey: eventKeys.pages(siteId, kinds),
    queryFn: ({ pageParam, signal }) =>
      priceEventPage(
        { siteId, kinds, cursor: pageParam, limit: LOG_PAGE },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// What each kind says, in the fewest words that keep the five apart.
///
/// "Published" and "In service" are deliberately not near-synonyms: the whole
/// point of the split is that one is head office and the other is a till.
export function describeEventKind(kind: string): string {
  switch (kind) {
    case "PUBLISHED":
      return "Published"
    case "SENT":
      return "Sent to shop"
    case "ACTIVATED":
      return "In service"
    case "FAILED":
      return "Failed"
    case "EXPIRED":
      return "Expired"
    default:
      return kind
  }
}
