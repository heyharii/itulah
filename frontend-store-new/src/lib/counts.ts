import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Counts head office asked this store to take.
///
/// Hand-written against the store node's counts API. The count is blind by
/// design: the node never sends what the book expects, so nothing here has a
/// field for it and nothing drawn from it may imply one.

export type CountKind = "FULL" | "CYCLE" | "TARGETED"
export type CountStatus =
  "ACTIVE" | "SUBMITTED" | "ADJUSTMENT_PENDING" | "CLOSED"

export interface StoreCount {
  readonly count_id: string
  readonly site_id: string
  readonly pool_id: string
  readonly kind: CountKind
  readonly status: CountStatus
  readonly reason: string | null
  readonly created_at: string
  readonly activated_at: string | null
  readonly submitted_at: string | null
  readonly closed_at: string | null
  readonly counted: number
  readonly adjustment_status: string | null
}

export interface ScannedPiece {
  readonly epc: string
  readonly sku_code: string
  readonly found_quantity: number
}

export interface StoreCountDetail extends StoreCount {
  readonly scanned: readonly ScannedPiece[]
}

/// The handheld's sweep files entries; this app only reads them.
export const COUNT_POLL_MS = 15_000
/// How often an open, active count is re-read for what the handheld filed.
export const COUNT_LIVE_MS = 5_000

export const countsKey = () => ["store", "counts"] as const
export const countKey = (countId: string) =>
  ["store", "counts", countId] as const

export function fetchCounts(signal?: AbortSignal): Promise<StoreCount[]> {
  return node
    .get<{ items: StoreCount[] }>("/api/v1/store/counts", { signal })
    .then((body) => body.items)
}

export function fetchCount(
  countId: string,
  signal?: AbortSignal,
): Promise<StoreCountDetail> {
  return node.get<StoreCountDetail>(
    `/api/v1/store/counts/${encodeURIComponent(countId)}`,
    { signal },
  )
}

export function submitCount(
  countId: string,
  idempotencyKey: string,
): Promise<{ count_id: string; status: CountStatus; submitted_at: string }> {
  return node.post(
    `/api/v1/store/counts/${encodeURIComponent(countId)}/submit`,
    { actor_id: "", idempotency_key: idempotencyKey },
  )
}

export const countsQuery = () =>
  queryOptions({
    queryKey: countsKey(),
    queryFn: ({ signal }) => fetchCounts(signal),
    staleTime: COUNT_POLL_MS,
  })

export function useCounts() {
  return useQuery({ ...countsQuery(), refetchInterval: COUNT_POLL_MS })
}

export function useCount(countId: string, live = false) {
  return useQuery({
    queryKey: countKey(countId),
    queryFn: ({ signal }) => fetchCount(countId, signal),
    staleTime: COUNT_LIVE_MS,
    refetchInterval: live ? COUNT_LIVE_MS : false,
  })
}

/// Counts still to do, for the sidebar's badge.
export function useOpenCounts(): number {
  return (
    useCounts().data?.filter((count) => count.status === "ACTIVE").length ?? 0
  )
}
