import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import { SHOW_MISSING } from "@/lib/features"
import {
  inventoryKeys,
  missingPage,
  type MissingItem,
  type MissingScope,
} from "@/lib/queries/inventory"

const SCOPE: MissingScope = { sort: "missing_since", limit: 500 }

export interface MissingGroup {
  readonly key: string
  readonly sku: string
  readonly name: string | null
  /// Where it went missing: the step, and the document.
  readonly from: string | null
  readonly fromRef: string | null
  readonly pool: string
  readonly poolLabel: string
  readonly site: string
  readonly left: number
  /// Whole days since the oldest row went missing.
  readonly days: number | null
  readonly rows: readonly MissingItem[]
}

/// Every missing row, oldest first. Walks the cursor to the end: the grouped
/// totals would be wrong over a partial list.
export function useMissingRows() {
  const query = useInfiniteQuery({
    queryKey: inventoryKeys.missing(SCOPE),
    queryFn: ({ pageParam, signal }) =>
      missingPage({ ...SCOPE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // Hidden for now (SHOW_MISSING): nothing is fetched.
    enabled: SHOW_MISSING,
  })
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

/// The movement cause that carried a piece into Missing, as the step people
/// know it by. An unknown cause is shown as it is spelled, tidied.
function stepOf(
  cause: string | null,
  referenceType: string | null
): string | null {
  if (cause === null) return null
  // A piece the destination did not find at its door (`STORE_RECEIPT`).
  if (referenceType === "STORE_RECEIPT") return "Receive"
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

export function groupMissing(rows: readonly MissingItem[]): MissingGroup[] {
  const groups = new Map<string, MissingItem[]>()
  for (const row of rows) {
    if (row.quantity <= 0) continue
    const key = `${row.sku_code ?? row.subject_id}@${row.origin_pool}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const out: MissingGroup[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort(
      (a, b) => (b.age_hours ?? -1) - (a.age_hours ?? -1)
    )
    const hours = sorted[0].age_hours
    out.push({
      key,
      sku: sorted[0].sku_code ?? sorted[0].epc ?? sorted[0].subject_id,
      name: sorted[0].article_name,
      from: stepOf(sorted[0].missing_cause, sorted[0].missing_reference_type),
      fromRef: sorted[0].missing_reference_id,
      pool: sorted[0].origin_pool,
      poolLabel: sorted[0].pool_label,
      site: sorted[0].site_id,
      left: sorted.reduce((sum, row) => sum + row.quantity, 0),
      days: hours === null ? null : Math.floor(hours / 24),
      rows: sorted,
    })
  }
  return out.sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
}
