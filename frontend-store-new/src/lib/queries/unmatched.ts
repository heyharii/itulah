import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Sales this shop made of a piece its own stock could not account for
/// (`docs/unmatched-sales-contract.md`, 23 Oct 2026).
///
/// The till never refuses such a sale — the shopper paid, the sale belongs to
/// this shop — and head office matches it later to a piece somewhere else.
/// This shop only reads where each one stands, so there is no write here:
/// `GET /api/v1/store/unmatched?status=` is the node relaying head office's
/// list for this site.
///
/// Hand-written against the contract, not the generated barrel: the route is
/// new, and `make contract` has not been asked to draw it yet.

/// What the till could not take from the shop's own stock.
///
///  - `NO_TAG` — a SKU typed off the label, and the shop holds some of it
///  - `NOT_IN_STOCK` — a SKU typed, and the shop holds none
///  - `OTHER` — a read tag the shop does not hold (elsewhere, in transit…)
///  - `UNKNOWN` — no SKU: the store head named it and priced it
export type UnmatchedKind = "NO_TAG" | "OTHER" | "NOT_IN_STOCK" | "UNKNOWN"

/// The three lists head office keeps, as the route's `status` spells them.
export type UnmatchedStatus = "open" | "matched" | "found"

/// One line a till sold that it could not take from its own stock — the hub's
/// list row, for this site only.
export interface UnmatchedSale {
  readonly id: string
  /// When it was sold, an ISO timestamp.
  readonly sold_at: string
  /// The receipt number as the till printed it.
  readonly receipt_no: string
  /// The till's label ("Till 1").
  readonly till: string | null
  readonly cashier_name: string | null
  readonly kind: UnmatchedKind
  /// Eleven plain digits, when the line named a SKU.
  readonly sku_code: string | null
  /// What head office's book calls that SKU.
  readonly article_name: string | null
  readonly colour: string | null
  readonly size: string | null
  /// What the store head typed, for an unknown item.
  readonly name: string | null
  readonly price_minor: number
  /// The store head who named and priced an unknown item.
  readonly priced_by_name: string | null
  readonly status: string
  /// How it was matched: "Transfer from {place}", "Own stock", "Count · {doc}".
  readonly matched_with: string | null
  readonly matched_at: string | null
  /// What the piece cost, where head office sends it with a find at a count.
  /// The contract's row does not carry it yet; the Found list says "—" until
  /// it does.
  readonly cost_minor?: number | null
}

/// How often the lists are read again. A sale is matched at head office, not
/// at this counter, so nothing here needs to be faster than a person looking.
export const UNMATCHED_POLL_MS = 15_000

export const unmatchedKey = (status: UnmatchedStatus) =>
  ["store", "unmatched", status] as const

export function fetchUnmatched(
  status: UnmatchedStatus,
  signal?: AbortSignal,
): Promise<UnmatchedSale[]> {
  return node
    .get<{ rows: UnmatchedSale[] } | UnmatchedSale[]>(
      `/api/v1/store/unmatched?status=${status}`,
      { signal },
    )
    .then((body) => (Array.isArray(body) ? body : body.rows))
}

export const unmatchedQuery = (status: UnmatchedStatus) =>
  queryOptions({
    queryKey: unmatchedKey(status),
    queryFn: ({ signal }) => fetchUnmatched(status, signal),
    staleTime: UNMATCHED_POLL_MS,
  })

export function useUnmatched(status: UnmatchedStatus) {
  return useQuery({
    ...unmatchedQuery(status),
    refetchInterval: UNMATCHED_POLL_MS,
  })
}

/// Sales still waiting to be matched, for the sidebar's badge.
export function useOpenUnmatched(): number {
  return useUnmatched("open").data?.length ?? 0
}
