/**
 * Purchase orders' write boundary, built directly on TanStack Query's
 * `useMutation`.
 *
 * A purchase order carries money (totals, unit prices, line totals), so per
 * M4 none of these three writes gets an optimistic patch — no `onMutate`, no
 * client-side guess at what the order looks like after the write. Each one
 * shows a pending state (`po-draft.tsx`'s `submitBusy`,
 * `purchase-orders.tsx`'s `cancel.isLoading` / `close.isLoading`) and waits
 * for the server, per M3's "Neither" row.
 *
 *  - `useCreatePurchaseOrder` backs `po-draft.tsx`'s submit. The draft closes
 *    on success — `purchase-orders.tsx`'s `onCreated` immediately navigates
 *    to `order=created.id` — and the Go handler already returns the full,
 *    server-priced order, so M7 applies: seed `poQueries.detail(created.id)`
 *    with it and mark it stale without a refetch (`refetchType: "none"`).
 *    Without that seed the freshly opened detail screen would show "Loading
 *    order…" for a request whose answer is already sitting in hand. The
 *    order list is a different query (a new row, and every status-filtered
 *    list variant's count changes) and gets a real invalidation so it
 *    actually refetches.
 *
 *    Creating a PO also consumes shortlisted candidates — `po/api.ts`'s own
 *    comment on the old `useCreatePurchaseOrder` said as much — so the
 *    shortlist keeps being invalidated alongside the order list. That's the
 *    one cross-domain edge this file has: `shortlistQueries` is read-only
 *    imported from `@/components/sourcing/queries`, sourcing itself is not
 *    touched, and `sourcing/mutations.ts`'s own shortlist writes invalidate
 *    the same prefix the same way.
 *
 *  - `useCancelPurchaseOrder` / `useClosePurchaseOrder` back
 *    `purchase-orders.tsx`'s `OrderView` action buttons. Both return the
 *    updated order, so the same M7 seed applies to the order's own detail
 *    key; the list is invalidated by the `["po", "list"]` prefix (every
 *    status-filtered variant, since a cancel/close can move an order out of
 *    whichever one it was just counted in) without touching the detail
 *    query that was just seeded.
 *
 * M5 holds throughout: `po-draft.tsx` never invents a PO number or line id —
 * `createPurchaseOrder`'s `toOrder()` mapping only ever reads what the Go API
 * actually returned, id recovery on the queued-command 400 included.
 *
 * M6: `po-draft.tsx` already generates `idempotencyKey.current` once via
 * `newIdempotencyKey()` and reuses it across retries of the same submit
 * attempt (see the `submit` handler) — that discipline lives in the screen,
 * not here, and this file passes the key straight through unchanged.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import { shortlistQueries } from "@/components/sourcing/queries"
import type { PurchaseOrder } from "@/components/commerce/store"
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  type PurchaseOrderCloseInput,
  type PurchaseOrderWriteInput,
} from "./api"
import { poQueries } from "./queries"

/** Every list-query variant (any status filter, or none). */
const poListPrefix = () => [...poQueries.all(), "list"] as const

/** Seeds one order's detail cache with the response that already carries it (M7). */
function seedOrderDetail(client: ReturnType<typeof useQueryClient>, order: PurchaseOrder): void {
  const key = poQueries.detail(order.id).queryKey
  client.setQueryData(key, order)
  void client.invalidateQueries({ queryKey: key, refetchType: "none" })
}

/**
 * Creates a purchase order. Money (M4) — no optimistic order, wait for the
 * server. Consumes shortlisted candidates, so the shortlist invalidates
 * alongside the order list (cross-domain edge documented above).
 */
export function useCreatePurchaseOrder(): ApiMutation<PurchaseOrderWriteInput, PurchaseOrder> {
  const client = useQueryClient()
  const mutation = useMutation<PurchaseOrder, Error, PurchaseOrderWriteInput>({
    mutationFn: (input) => createPurchaseOrder(input),
    onSuccess: (order) => {
      seedOrderDetail(client, order)
      void client.invalidateQueries({ queryKey: poListPrefix() })
      void client.invalidateQueries({ queryKey: shortlistQueries.all() })
    },
  })
  return toApiMutation(mutation)
}

/** `active → cancelled`. Money-adjacent lifecycle transition — wait for the server. */
export function useCancelPurchaseOrder(): ApiMutation<string, PurchaseOrder> {
  const client = useQueryClient()
  const mutation = useMutation<PurchaseOrder, Error, string>({
    mutationFn: (id) => cancelPurchaseOrder(id),
    onSuccess: (order) => {
      seedOrderDetail(client, order)
      void client.invalidateQueries({ queryKey: poListPrefix() })
    },
  })
  return toApiMutation(mutation)
}

/** `active → closed`. Money-adjacent lifecycle transition — wait for the server. */
export function useClosePurchaseOrder(): ApiMutation<PurchaseOrderCloseInput, PurchaseOrder> {
  const client = useQueryClient()
  const mutation = useMutation<PurchaseOrder, Error, PurchaseOrderCloseInput>({
    mutationFn: (input) => closePurchaseOrder(input.id, input.reason),
    onSuccess: (order) => {
      seedOrderDetail(client, order)
      void client.invalidateQueries({ queryKey: poListPrefix() })
    },
  })
  return toApiMutation(mutation)
}
