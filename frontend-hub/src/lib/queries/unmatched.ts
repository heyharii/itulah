import { queryOptions, useQuery } from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import { useMemo } from "react"

import { node } from "@/lib/api"

/// Unmatched sales: lines a till sold that it could not take from its own
/// store's stock (`docs/unmatched-sales-contract.md`, "HO routes").
///
/// The routes are hand-written JSON on the cloud, so the types below are
/// transcribed from the contract and nothing checks them at build time: if a
/// column reads `undefined` on the screen, the contract is the first place to
/// look. Money is whole rupiah (`money()` draws it).

/// The three tabs of the screen, and the word the endpoint takes for each.
export type UnmatchedStatus = "open" | "matched" | "found"

/// Why the till could not take the piece from its own stock.
///
/// | wire           | the till says  | the hub says  |
/// |----------------|----------------|---------------|
/// | `NO_TAG`       | Tanpa tag      | No tag        |
/// | `NOT_IN_STOCK` | Luar toko      | Not in stock  |
/// | `OTHER`        | Dari {tempat}  | Other place   |
/// | `UNKNOWN`      | Tak dikenal    | Unknown item  |
export type UnmatchedKind = "NO_TAG" | "NOT_IN_STOCK" | "OTHER" | "UNKNOWN"

export interface UnmatchedSale {
  readonly id: string
  /// The store where the shopper paid: the sale always belongs to it.
  readonly site_id: string
  readonly site_name: string
  readonly sold_at: string
  /// The receipt number as the till printed it.
  readonly receipt_no: string
  readonly till: string | null
  readonly cashier_name: string | null
  readonly kind: UnmatchedKind
  /// Eleven digits; null for an unknown item until it is matched.
  readonly sku_code: string | null
  readonly article_name: string | null
  readonly colour: string | null
  readonly size: string | null
  /// What the head of store typed for an unknown item.
  readonly name: string | null
  readonly price_minor: number
  /// Who priced an unknown item.
  readonly priced_by_name: string | null
  readonly status: "OPEN" | "MATCHED" | "FOUND"
  /// "Transfer from {place}" · "Own stock" · "Count · {doc}".
  readonly matched_with: string | null
  readonly matched_at: string | null
  /// What a found piece cost. Not in the contract's row yet: drawn as "—"
  /// until the cloud sends it.
  readonly cost_minor?: number | null
}

/// A place a piece can be taken from: head office first, then the stores A–Z.
export interface UnmatchedPlace {
  readonly site_id: string
  readonly name: string
  readonly is_ho: boolean
}

/// One article held at a place, at least one on hand.
export interface UnmatchedStockRow {
  readonly sku_code: string
  readonly article_name: string
  readonly colour: string | null
  readonly size: string | null
  readonly on_hand: number
}

export interface MatchRequest {
  readonly site_id: string
  readonly sku_code: string
  readonly idempotency_key: string
}

export const unmatchedKeys = {
  all: ["sales", "unmatched"] as const,
  list: (status: UnmatchedStatus) =>
    ["sales", "unmatched", "list", status] as const,
  places: () => ["sales", "unmatched", "places"] as const,
  stock: (siteId: string) => ["sales", "unmatched", "stock", siteId] as const,
}

export async function unmatchedSales(
  status: UnmatchedStatus,
  signal?: AbortSignal
): Promise<UnmatchedSale[]> {
  const found = await node.get<{ rows: UnmatchedSale[] }>(
    `/api/v1/sales/unmatched?status=${status}`,
    { signal }
  )
  return found.rows
}

/// One tab's rows. The screen and the prefetcher share it, so the answer is
/// warm when the screen opens.
export const unmatchedQuery = (status: UnmatchedStatus) =>
  queryOptions({
    queryKey: unmatchedKeys.list(status),
    queryFn: ({ signal }) => unmatchedSales(status, signal),
  })

export const unmatchedPlacesQuery = () =>
  queryOptions({
    queryKey: unmatchedKeys.places(),
    queryFn: ({ signal }) =>
      node.get<UnmatchedPlace[]>("/api/v1/sales/unmatched/places", { signal }),
    staleTime: 5 * 60 * 1000,
  })

export const unmatchedStockQuery = (siteId: string) =>
  queryOptions({
    queryKey: unmatchedKeys.stock(siteId),
    queryFn: ({ signal }) =>
      node.get<UnmatchedStockRow[]>(
        `/api/v1/sales/unmatched/stock?site_id=${encodeURIComponent(siteId)}`,
        { signal }
      ),
  })

/// Take one piece of that SKU out of that place's stock and pair it with the
/// sale. A place other than the selling store makes the transfer at cost
/// (`match_doc` `TRF-####`); the selling store's own stock is "Own stock".
/// Returns the row, now matched.
export function matchUnmatched(id: string, request: MatchRequest) {
  return node.post<UnmatchedSale>(
    `/api/v1/sales/unmatched/${encodeURIComponent(id)}/match`,
    request
  )
}

/// The sidebar's count: sales still to match. `null` until the page has
/// hydrated and the read is in, which the sidebar reads as *not yet* rather
/// than *none* (the server draws the same HTML).
export function useUnmatchedCount(): number | null {
  const hydrated = useHydrated()
  const open = useQuery(unmatchedQuery("open"))
  return useMemo(
    () => (!hydrated || open.data === undefined ? null : open.data.length),
    [hydrated, open.data]
  )
}
