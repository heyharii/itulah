import { dayMonth } from "@/lib/format"
import {
  infiniteQueryOptions,
  queryOptions,
  useQuery,
  useInfiniteQuery,
} from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import { useEffect, useMemo } from "react"

import {
  inventoryKeys,
  missingPage,
  type MissingItem,
  type MissingScope,
} from "@/lib/queries/inventory"

const SCOPE: MissingScope = { sort: "missing_since", limit: 500 }

/// One article at one place: every missing tag of a SKU at a site is one line,
/// however many pockets it was lost from. The origin pocket of the oldest row
/// is where it "was lost in".
export interface MissingGroup {
  readonly key: string
  readonly sku: string
  readonly name: string | null
  /// Where it went missing: the step, and the document.
  readonly from: string | null
  readonly fromRef: string | null
  /// Where the document opens: its allotment, or the count.
  readonly doc:
    | { readonly path: string; readonly key: string; readonly value: string }
    | null
  /// The pocket the oldest row went missing from: its canonical id and label.
  readonly pool: string
  readonly poolLabel: string
  readonly site: string
  /// Lost on the road (an in-transit pocket): Stock counts it under In
  /// transit, not under the place that sent it, and so does this list.
  readonly transit: boolean
  /// Booked by a store's own node, which alone can post Found or Lost.
  readonly nodeOwned: boolean
  readonly left: number
  /// When the oldest row went missing (ISO), and whole days since.
  readonly since: string | null
  readonly days: number | null
  /// Oldest first.
  readonly rows: readonly MissingItem[]
}

/// The whole list as an infinite query, shared by the screen and the
/// prefetcher.
export const missingRowsQuery = () =>
  infiniteQueryOptions({
    queryKey: inventoryKeys.missing(SCOPE),
    queryFn: ({ pageParam, signal }) =>
      missingPage({ ...SCOPE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The first page only, for the sidebar badge and the Stock cards: a plain
/// read, asked in the browser, that never walks the cursor.
export const missingBadgeQuery = () =>
  queryOptions({
    queryKey: [...inventoryKeys.missing(SCOPE), "first-page"] as const,
    queryFn: ({ signal }) => missingPage(SCOPE, signal),
  })

/// Every missing row, oldest first. Walks the cursor to the end: the grouped
/// totals would be wrong over a partial list.
export function useMissingRows() {
  const query = useInfiniteQuery(missingRowsQuery())
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data]
  )
  return { query, rows }
}

/// The sidebar badge: how many article-at-place lines are missing. `null`
/// until the page is hydrated and the read is in, which the sidebar reads as
/// *not yet*, not as *none* (the server draws the same HTML).
export function useMissingCount(): number | null {
  const hydrated = useHydrated()
  const page = useQuery(missingBadgeQuery())
  return useMemo(
    () =>
      !hydrated || page.data === undefined
        ? null
        : groupMissing(page.data.rows).length,
    [hydrated, page.data]
  )
}

/// The movement cause that carried a piece into Missing, as the step people
/// know it by. An unknown cause is shown as it is spelled, tidied.
export function stepOf(
  cause: string | null,
  referenceType: string | null
): string | null {
  if (cause === null) return null
  // A piece the destination did not find at its door (`STORE_RECEIPT`).
  if (referenceType === "STORE_RECEIPT") return "Receive"
  // A Cannot pick MD accepted short is booked against the allotment line.
  if (referenceType === "ALLOTMENT_LINE" && cause === "COUNT_SHORTAGE")
    return "Pick"
  const known: Record<string, string> = {
    PICK: "Pick",
    PICK_SHORT: "Pick",
    PACK: "Pack",
    PACK_SHORT: "Pack",
    IN_TRANSIT: "Transit",
    STORE_RECEIVE: "Store receive",
    RETURN_TO_WAREHOUSE: "HO receive",
    COUNT: "Count",
    COUNT_VARIANCE: "Count",
    COUNT_SHORTAGE: "Count",
    RECONCILIATION: "Count",
  }
  const upper = cause.toUpperCase()
  if (known[upper]) return known[upper]
  const words = upper.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/// A document a person reads: a count's or receipt's uuid is cut to the
/// first block, which is how the hub names counts elsewhere.
export function shortRef(ref: string | null): string | null {
  if (ref === null) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ref) ? ref.slice(0, 8) : ref
}

/// An in-transit pocket: `dc.outbound.in-transit`, `store-02.outbound.in-transit`.
export const isTransitPool = (poolId: string) =>
  poolId.endsWith(".outbound.in-transit")

/// Where a group stands, in the words Stock uses.
export const placeOfGroup = (
  group: Pick<MissingGroup, "site" | "transit">,
  placeName: (siteId: string) => string
) => (group.transit ? "In transit" : placeName(group.site))

export function groupMissing(rows: readonly MissingItem[]): MissingGroup[] {
  const groups = new Map<string, MissingItem[]>()
  for (const row of rows) {
    if (row.quantity <= 0) continue
    const transit = isTransitPool(row.origin_pool)
    const key = `${row.sku_code ?? row.subject_id}@${row.site_id}${transit ? ":transit" : ""}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const out: MissingGroup[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort(
      (a, b) => (b.age_hours ?? -1) - (a.age_hours ?? -1)
    )
    const oldest = sorted[0]
    const hours = oldest.age_hours
    out.push({
      key,
      sku: oldest.sku_code ?? oldest.epc ?? oldest.subject_id,
      name: oldest.article_name,
      from: stepOf(oldest.missing_cause, oldest.missing_reference_type),
      // The document by the name people know (owner, 20 Oct 2026): the
      // allotment's number; a count by its day.
      fromRef:
        oldest.missing_reference_number ??
        (oldest.missing_reference_type === "OFFICIAL_COUNT" &&
        oldest.missing_since !== null
          ? dayMonth(oldest.missing_since)
          : shortRef(oldest.missing_reference_id)),
      doc:
        oldest.missing_allotment_id != null
          ? {
              path: "/allotment",
              key: "allotment",
              value: oldest.missing_allotment_id,
            }
          : oldest.missing_reference_type === "OFFICIAL_COUNT" &&
              oldest.missing_reference_id !== null
            ? {
                path: "/inventory/counts",
                key: "count",
                value: oldest.missing_reference_id,
              }
            : null,
      pool: oldest.origin_pool,
      poolLabel: oldest.pool_label,
      site: oldest.site_id,
      transit: isTransitPool(oldest.origin_pool),
      nodeOwned: sorted.some((row) => (row.owner_origin_id ?? null) !== null),
      left: sorted.reduce((sum, row) => sum + row.quantity, 0),
      since:
        oldest.missing_since ??
        (hours === null
          ? null
          : new Date(Date.now() - hours * 3_600_000).toISOString()),
      days: hours === null ? null : Math.floor(hours / 24),
      rows: sorted,
    })
  }
  return out.sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
}
