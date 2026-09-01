/**
 * Sourcing's write boundary, built directly on TanStack Query's
 * `useMutation`.
 *
 * All five writes here are the same optimistic shape: **neither** (see
 * docs/tanstack-gap-plan.md §0).
 *
 *  - The shortlist star (`toggleShortlist` in sourcing.tsx) already renders
 *    its own pending state from local `shortlistBusyId` / `clearBusy`
 *    component state, not from the mutation. A membership change is visible
 *    on two screens at once — the star in Sourcing, the staged rows in
 *    Shortlist — and patching both caches optimistically (and rolling both
 *    back together on a rejected write) is real complexity for a toggle
 *    whose worst case, on `onSettled`, is a one-request-round-trip delay.
 *    Wait for the server and invalidate both prefixes; keep
 *    `shortlistWriteInvalidates()`'s behaviour exactly as it was.
 *  - `useCreateSourcingItem` and `useCreateSourcingSupplier` back sheets that
 *    close on success (sourcing.tsx's source sheet, the supplier picker in
 *    po-draft.tsx) — nothing left on screen to patch once the sheet is gone.
 *  - None of the five may invent a server-generated id optimistically (M5):
 *    the sourcing-item id, the supplier id and the shortlist-list id are all
 *    minted by Internal.
 *
 * These hooks return the shared `ApiMutation<TInput, TOutput>` shape (see
 * `@/lib/api/async-state`), because sourcing.tsx and
 * `@/components/po/po-draft.tsx` (a different domain, not touched here) read
 * `.execute` off them unchanged.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import {
  addSourcingShortlistEntry,
  clearSourcingShortlist,
  createSourcingItem,
  createSourcingSupplier,
  removeSourcingShortlistEntry,
  type ShortlistAddInput,
  type SourcingItemWriteInput,
  type SupplierWriteInput,
} from "./api"
import { shortlistQueries, sourcingQueries } from "./queries"

/* A function, not a module-level constant — `./api` and `./queries` already
 * cycle with each other (queries.ts imports the fetchers, api.ts imports the
 * key factories), and this module sits in the middle of that cycle too.
 * Calling `.all()` inside a function defers the read until the graph is
 * whole, the same discipline `./api`'s own `shortlistWriteInvalidates` uses. */
const shortlistWriteInvalidates = () => [
  [...shortlistQueries.all()],
  [...sourcingQueries.all()],
]

/** Adds one sourcing item to the working shortlist. */
export function useAddShortlistEntry(): ApiMutation<ShortlistAddInput, unknown> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, ShortlistAddInput>({
    mutationFn: (input) =>
      addSourcingShortlistEntry(input.sourcingItemId, {
        colorwayId: input.colorwayId,
        note: input.note,
      }),
    onSettled: () => {
      for (const key of shortlistWriteInvalidates()) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
  return toApiMutation(mutation)
}

/** Removes one sourcing item from every named shortlist that holds it. */
export function useRemoveShortlistEntry(): ApiMutation<string, void> {
  const client = useQueryClient()
  const mutation = useMutation<void, Error, string>({
    mutationFn: (sourcingItemId) => removeSourcingShortlistEntry(sourcingItemId),
    onSettled: () => {
      for (const key of shortlistWriteInvalidates()) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
  return toApiMutation(mutation)
}

/** Clears every membership while keeping the operator's named lists. */
export function useClearShortlist(): ApiMutation<void, void> {
  const client = useQueryClient()
  const mutation = useMutation<void, Error, void>({
    mutationFn: () => clearSourcingShortlist(),
    onSettled: () => {
      for (const key of shortlistWriteInvalidates()) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
  return toApiMutation(mutation)
}

/** Creates a supplier-product candidate and refreshes the catalogue. */
export function useCreateSourcingItem(): ApiMutation<SourcingItemWriteInput, unknown> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, SourcingItemWriteInput>({
    mutationFn: (input) => createSourcingItem(input),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: sourcingQueries.all() })
    },
  })
  return toApiMutation(mutation)
}

/** Creates a supplier; the catalogue carries the supplier master data. */
export function useCreateSourcingSupplier(): ApiMutation<SupplierWriteInput, unknown> {
  const client = useQueryClient()
  const mutation = useMutation<unknown, Error, SupplierWriteInput>({
    mutationFn: (input) => createSourcingSupplier(input),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: sourcingQueries.all() })
    },
  })
  return toApiMutation(mutation)
}
