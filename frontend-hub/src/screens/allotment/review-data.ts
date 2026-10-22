import { useQuery } from "@tanstack/react-query"

import { dcNode, node } from "@/lib/api"
import {
  flagged,
  shortReasonLabel,
  type ShortPick,
} from "@/lib/operations/changes"
import { useDcHosting } from "@/lib/edge-session"
import { shortPicksQuery } from "@/lib/operations/queries"
import type { AllotmentLine } from "@/lib/queries/inventory"

/// **MD's In review** (allotment-review-flow.html, owner 17–18 Oct 2026).
///
/// Two places a piece can stop on its way to a store, and MD answers both:
///
/// - **At the DC**: a picker said Cannot continue — the only place Ops can,
///   a shortage at Pack or Dispatch goes back to Pick first. That is a short
///   pick (`cloud/dc/short_pick.rs`) still flagged (OPEN or LOST). MD answers
///   **Continue** (the picker tries again) or **Accept short** (Close short).
/// - **At the store**: a store's blind count differs from what its surat jalan
///   says. One review per trip (`GET …/store-reviews`), the stores' counts
///   paired across the trip: wrong store, not received, extra. MD answers
///   **Accept as delivered** or **Return & reallot**.
///
/// One review is one allotment × one store: everything its pickers could not
/// pick for that store, answered at once.

export interface DcReviewLine {
  readonly sku_code: string
  readonly article_name: string
  /// Still to pick of what the picker could not find.
  readonly short: number
  readonly reason: string
  /// The reports this line is made of — Continue answers each.
  readonly reportIds: readonly string[]
}

export interface DcReview {
  /// `allotment × store`.
  readonly key: string
  readonly allotment_id: string
  readonly allotment_number: string
  readonly store_id: string
  readonly lines: readonly DcReviewLine[]
  readonly short: number
  /// The newest report's reason, by, and when — what the card says.
  readonly reason: string
  readonly reported_by: string
  readonly reported_at: string
}

/// The short picks still waiting for MD, one review per allotment × store,
/// newest first.
export function dcReviewsOf(reports: readonly ShortPick[]): DcReview[] {
  const open = reports.filter((one) => flagged(one) && one.still_short > 0)
  const byKey = new Map<string, ShortPick[]>()
  for (const report of open) {
    const key = `${report.allotment_id}×${report.destination_id}`
    byKey.set(key, [...(byKey.get(key) ?? []), report])
  }
  return [...byKey.entries()]
    .map(([key, mine]) => {
      // The list is newest first: the first report is the newest.
      const newest = mine[0]
      const bySku = new Map<string, ShortPick[]>()
      for (const report of mine)
        bySku.set(report.sku_code, [
          ...(bySku.get(report.sku_code) ?? []),
          report,
        ])
      const lines = [...bySku.values()].map((sku) => ({
        sku_code: sku[0].sku_code,
        article_name: sku[0].article_name,
        // Reports on one line overlap — each counts what is still to pick
        // of the same line — so the line is short by the largest of them.
        short: Math.max(...sku.map((one) => one.still_short)),
        // Cannot pick asks for a Note only (owner, 18 Oct 2026): the Note is
        // what the picker said; a reason is read only from an older report.
        reason: sku[0].note?.trim() || shortReasonLabel(sku[0].reason),
        reportIds: sku.map((one) => one.id),
      }))
      return {
        key,
        allotment_id: newest.allotment_id,
        allotment_number: newest.allotment_number,
        store_id: newest.destination_id,
        lines,
        short: lines.reduce((sum, line) => sum + line.short, 0),
        reason: newest.note?.trim() || shortReasonLabel(newest.reason),
        reported_by: newest.reported_by,
        reported_at: newest.reported_at,
      }
    })
    .sort((a, b) => b.reported_at.localeCompare(a.reported_at))
}

/// MD's At the DC reviews, from the same 30-second read the board polls.
///
/// It waits for where the warehouse is hosted: MD never passes Operations'
/// gate, which is what asks, and a read sent before the answer goes to the
/// `/edge` proxy, which a cloud-hosted Gudang does not have (21 Oct 2026: MD's
/// In review showed no short pick at all).
export function useDcReviews(enabled = true) {
  const hosting = useDcHosting()
  const query = useQuery({
    ...shortPicksQuery(),
    enabled: enabled && hosting !== undefined,
  })
  return {
    reviews: query.data === undefined ? undefined : dcReviewsOf(query.data),
    query,
  }
}

/// MD answers Continue on every report of one review.
export function continueShortPicks(ids: readonly string[]) {
  return dcNode().post<{ items: ShortPick[] }>(
    "/api/v1/dc/short-picks/continue",
    { ids }
  )
}

/// A review's lines matched to the allotment's own lines for that store: the
/// line to close short, and what MD asked for (its target now).
export function linesFor(
  review: DcReview,
  lines: readonly AllotmentLine[] | undefined
): {
  readonly line: DcReviewLine
  readonly allotted: AllotmentLine | undefined
}[] {
  return review.lines.map((line) => ({
    line,
    allotted: lines?.find(
      (one) =>
        one.destination_id === review.store_id && one.sku_code === line.sku_code
    ),
  }))
}

// ── At the store ──────────────────────────────────────────────────────────

/// The wire of `cloud/postgres/allotment_store_review.rs`, by hand until
/// `make contract` has seen it.
export interface StoreReviewStore {
  readonly store_id: string
  readonly store_name: string | null
  readonly shipment_number: string
  readonly sent: number
  /// `null` until the store has counted.
  readonly counted: number | null
  readonly counted_by: string | null
  readonly counted_at: string | null
  /// Its count differs from what was sent: MD answers it.
  readonly in_review: boolean
  /// The stores still to count its answer waits for (owner, 20 Oct 2026).
  readonly waiting_for: readonly string[]
  /// MD's answer for this store, once given.
  readonly decision: "AS_DELIVERED" | "RETURN_REALLOT" | null
  readonly decided_by: string | null
  readonly decided_at: string | null
}

export interface StoreReviewCell {
  readonly store_id: string
  readonly sent: number
  readonly counted: number | null
  readonly booked: number | null
}

export interface StoreReviewSku {
  readonly sku_code: string
  readonly article_id: string | null
  readonly article_code: string | null
  readonly article_name: string | null
  readonly image_url: string | null
  readonly colour: string | null
  readonly size: string | null
  readonly stores: readonly StoreReviewCell[]
}

export interface StoreReviewPair {
  readonly sku_code: string
  readonly pieces: number
  readonly meant_for: string
  readonly arrived_at: string
}

export interface StoreReviewPieces {
  readonly sku_code: string
  readonly store_id: string
  readonly pieces: number
}

export interface StoreReview {
  readonly dispatch_id: string
  readonly dispatch_number: string
  readonly departed_at: string | null
  readonly allotments: readonly {
    readonly allotment_id: string
    readonly allotment_number: string
  }[]
  readonly stores: readonly StoreReviewStore[]
  readonly skus: readonly StoreReviewSku[]
  readonly wrong_store: readonly StoreReviewPair[]
  readonly not_received: readonly StoreReviewPieces[]
  readonly extra: readonly StoreReviewPieces[]
  readonly waiting_for: readonly string[]
}

export interface StoreReviewMove {
  readonly store_id: string
  readonly sku_code: string
  readonly pieces: number
}

export interface StoreReviewReallot {
  readonly store_id: string
  readonly sku_code: string
  readonly pieces: number
  readonly dc_has: number
  readonly sent: number
}

export interface StoreReviewPlan {
  readonly keep: readonly StoreReviewMove[]
  readonly send_back: readonly StoreReviewMove[]
  readonly missing: readonly StoreReviewMove[]
  readonly reallot: readonly StoreReviewReallot[]
  readonly reallot_allotment_id: string | null
  readonly reallot_allotment_number: string | null
  readonly not_told: readonly string[]
}

export interface StoreReviewDecision {
  readonly dispatch_id: string
  readonly dispatch_number: string
  readonly store_id: string | null
  readonly decision: "AS_DELIVERED" | "RETURN_REALLOT"
  readonly decided_by: string
  readonly decided_at: string
  readonly plan: StoreReviewPlan
}

export const storeReviewKeys = {
  all: () => ["inventory", "allotments", "store-reviews"] as const,
  plan: (dispatchId: string, decision: string, store?: string) =>
    [
      "inventory",
      "allotments",
      "store-reviews",
      dispatchId,
      "plan",
      decision,
      store ?? "",
    ] as const,
}

export async function storeReviews(signal?: AbortSignal) {
  const body = await node.get<{ reviews: StoreReview[] }>(
    "/api/v1/inventory/allotments/store-reviews",
    { signal }
  )
  return body.reviews
}

/// What an answer would do — the dialog shows it before MD answers.
export function storeReviewPlan(
  dispatchId: string,
  decision: "AS_DELIVERED" | "RETURN_REALLOT",
  signal?: AbortSignal,
  store?: string
) {
  const one = store === undefined ? "" : `&store=${encodeURIComponent(store)}`
  return node.get<StoreReviewPlan>(
    `/api/v1/inventory/allotments/store-reviews/${dispatchId}/plan?decision=${decision}${one}`,
    { signal }
  )
}

/// MD answers the trip whole, or one store of it (`store`).
export function decideStoreReview(
  dispatchId: string,
  decision: "AS_DELIVERED" | "RETURN_REALLOT",
  idempotencyKey: string,
  store?: string
) {
  return node.post<StoreReviewDecision>(
    `/api/v1/inventory/allotments/store-reviews/${dispatchId}/decide`,
    { decision, idempotency_key: idempotencyKey, store_id: store ?? null }
  )
}

/// MD's At the store reviews, polled as the In review tab's other half.
export function useStoreReviews(enabled = true) {
  return useQuery({
    queryKey: storeReviewKeys.all(),
    queryFn: ({ signal }) => storeReviews(signal),
    enabled,
    refetchInterval: 30_000,
  })
}

/// One issue of a trip, said as the prototype's P lines say it.
export type StoreIssue =
  | {
      readonly kind: "wrong"
      readonly sku: string
      readonly pieces: number
      readonly from: string
      readonly to: string
    }
  | {
      readonly kind: "short"
      readonly sku: string
      readonly pieces: number
      readonly at: string
    }
  | {
      readonly kind: "extra"
      readonly sku: string
      readonly pieces: number
      readonly at: string
    }

export function issuesOf(review: StoreReview): StoreIssue[] {
  return [
    ...review.wrong_store.map((one) => ({
      kind: "wrong" as const,
      sku: one.sku_code,
      pieces: one.pieces,
      from: one.meant_for,
      to: one.arrived_at,
    })),
    ...review.not_received.map((one) => ({
      kind: "short" as const,
      sku: one.sku_code,
      pieces: one.pieces,
      at: one.store_id,
    })),
    ...review.extra.map((one) => ({
      kind: "extra" as const,
      sku: one.sku_code,
      pieces: one.pieces,
      at: one.store_id,
    })),
  ]
}

/// Whether MD still has a store of a trip to answer: a store whose count
/// differs and has no answer, on a trip still in the review. A trip that
/// left the review is answered. Before the list has loaded nothing is known
/// and everything reads open.
export function useOpenReviews(): (dispatchId: string, storeId: string) => boolean {
  const reviews = useStoreReviews()
  return (dispatchId, storeId) => {
    if (reviews.data === undefined) return true
    const trip = reviews.data.find((one) => one.dispatch_id === dispatchId)
    if (trip === undefined) return false
    const store = trip.stores.find((one) => one.store_id === storeId)
    return store === undefined || store.counted === null
      ? true
      : store.in_review && store.decision === null
  }
}
