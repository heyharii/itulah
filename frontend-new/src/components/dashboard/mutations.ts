/**
 * Supplier directory's write boundary, built directly on TanStack Query's
 * `useMutation`.
 *
 * All three writes back a screen the supplier directory keeps on screen
 * (`dashboard.tsx`'s records table and the detail sheet it drives from the
 * same cache), and none of them is money (M4 is about a PO's totals and
 * unit prices, not a supplier record):
 *
 *  - `useCreateSupplier` / `useUpdateSupplier` back `supplier-sheet.tsx`,
 *    which closes on success (`dashboard.tsx`'s `saveRecord` calls
 *    `setSheetOpen(false)` once the write resolves) — per M3 that is
 *    **neither** optimistic shape, `onSettled`/`onSuccess` only. But the
 *    same `saveRecord` immediately re-opens the record it just saved via
 *    `setSearch({ open: savedId })`, and that detail sheet reads off the
 *    very same `supplierQueries.directory()` cache the table reads — so M7
 *    applies exactly as it does for `articles/mutations.ts`'s tag/division
 *    writes: the response is mapped with the same `mapSupplier` the read
 *    path uses, folded into the cached directory (a new id is appended, an
 *    existing one is replaced), and the query is invalidated with
 *    `refetchType: "none"`. Without the seed, reopening the record you just
 *    created would show nothing until an unrelated refetch happened to run.
 *  - `useBulkUpdateSuppliers` backs the selection toolbar's reversible
 *    "set inactive" action. It is a status change, not money, and the table
 *    already renders its own pending state from `dashboard.tsx`'s local
 *    `bulkBusy` flag rather than the mutation — so per M3 this is the
 *    variables-based row's "no rollback to get wrong" case in its simplest
 *    form: no `onMutate`. The bulk endpoint answers `{ affected }`, not the
 *    changed rows, so there is nothing to fold into the cache the way a
 *    single supplier's row can be (M5 also rules out inventing that row
 *    client-side) — `onSettled` invalidates and the table refetches.
 *
 * M5 holds throughout: `savedId`/`savedName` in `dashboard.tsx` already read
 * only the response Internal returns, never a client-guessed id.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import {
  bulkUpdateDashboardSuppliers,
  createDashboardSupplier,
  mapSupplier,
  updateDashboardSupplier,
  type ApiSupplier,
  type SupplierBulkInput,
  type SupplierWriteInput,
} from "./api"
import { supplierQueries } from "./queries"

/** Folds a create/update response into the cached directory (M7). */
function seedSupplierDirectory(
  client: ReturnType<typeof useQueryClient>,
  response: unknown
): void {
  const mapped = mapSupplier((response ?? {}) as ApiSupplier)
  if (!mapped) return
  const key = supplierQueries.directory().queryKey
  client.setQueryData(key, (current) => {
    if (!current) return current
    const index = current.suppliers.findIndex((s) => s.id === mapped.id)
    const suppliers =
      index === -1
        ? [...current.suppliers, mapped]
        : current.suppliers.map((s, i) => (i === index ? mapped : s))
    return {
      ...current,
      suppliers,
      total: index === -1 ? current.total + 1 : current.total,
    }
  })
  void client.invalidateQueries({ queryKey: key, refetchType: "none" })
}

/** Creates a supplier; the sheet that called this closes on success. */
export function useCreateSupplier(): ApiMutation<SupplierWriteInput, unknown> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, SupplierWriteInput>({
    mutationFn: (input) => createDashboardSupplier(input),
    onSuccess: (response) => seedSupplierDirectory(client, response),
  })
  return toApiMutation(mutation)
}

/** Updates one supplier by id; the sheet that called this closes on success. */
export function useUpdateSupplier(): ApiMutation<
  { id: string; input: SupplierWriteInput },
  unknown
> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, { id: string; input: SupplierWriteInput }>({
    mutationFn: ({ id, input }) => updateDashboardSupplier(id, input),
    onSuccess: (response) => seedSupplierDirectory(client, response),
  })
  return toApiMutation(mutation)
}

/** The reversible bulk status change behind the selection toolbar. */
export function useBulkUpdateSuppliers(): ApiMutation<SupplierBulkInput, unknown> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, SupplierBulkInput>({
    mutationFn: ({ ids, status }) => bulkUpdateDashboardSuppliers(ids, status),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: supplierQueries.directory().queryKey })
    },
  })
  return toApiMutation(mutation)
}
