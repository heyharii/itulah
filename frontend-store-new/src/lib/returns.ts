import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// What Merchandise asked this shop to send back to head office.
///
/// Hand-written against the store-returns contract in
/// `docs/goods-flow-build-2026-10.md`; the shop never starts a return, it only
/// answers one with **Sent**.

export interface StoreReturnLine {
  readonly sku_code: string
  readonly name: string | null
  readonly quantity: number
}

export interface StoreReturnAsk {
  readonly allotment_id: string
  readonly allotment_number: string
  readonly requested_at: string
  readonly quantity: number
  readonly lines: readonly StoreReturnLine[]
}

export interface StoreReturnSent {
  readonly shipment_number: string
  readonly quantity: number
}

export const returnsKey = () => ["store", "returns"] as const

export function fetchReturns(signal?: AbortSignal): Promise<StoreReturnAsk[]> {
  return node
    .get<{ items: StoreReturnAsk[] }>("/api/v1/store/return-requests", { signal })
    .then((body) => body.items)
}

/// Picks, packs, seals and dispatches the whole request in one act.
export function sendReturn(
  allotmentId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<StoreReturnSent> {
  return node.post<StoreReturnSent>(
    `/api/v1/store/return-requests/${encodeURIComponent(allotmentId)}/send`,
    { idempotency_key: idempotencyKey },
    { signal },
  )
}

export function useReturns() {
  return useQuery({
    queryKey: returnsKey(),
    queryFn: ({ signal }) => fetchReturns(signal),
    refetchInterval: 30_000,
  })
}

/// Open requests, for the sidebar's badge.
export function useOpenReturns(): number {
  return useReturns().data?.length ?? 0
}
