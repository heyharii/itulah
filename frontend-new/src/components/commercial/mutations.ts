/**
 * Commercial's write boundary, built directly on TanStack Query's
 * `useMutation`.
 *
 * Every commercial sheet in forms.tsx closes on success (`useSaver`'s `run`
 * calls `onClose()` once the write resolves). Per docs/tanstack-gap-plan.md
 * §0 that is the "neither" case: once the sheet is gone there is nothing on
 * screen left to patch optimistically, so this carries no `onMutate` and no
 * rollback — only `onSettled` invalidation (M1, M2).
 *
 * The hub gives no ETag and no server-generated row back through the shared
 * `useCommercialWrite` entry point (`work` is an arbitrary closure — a create,
 * a read-modify-write PUT, or a retire), so M7's `setQueryData` shortcut does
 * not apply here the way it can for a single typed write; the snapshot
 * refetches instead.
 *
 * `useCommercialWrite` returns the shared `ApiMutation<TInput, TOutput>`
 * shape (see `@/lib/api/async-state`), so forms.tsx keeps reading
 * `.execute` / `.isLoading` unchanged.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import { commercialQueries } from "./queries"

/**
 * The one hook every authoring sheet saves through.
 *
 * Each write is a plain request against one hub owner, and every one of them
 * changes something the commercial snapshot reads — a price, a markdown, a
 * rule, a campaign, a code. `onSettled` invalidates the whole commercial
 * domain (M2): the snapshot is the domain's one query (see
 * `commercialQueries.snapshot()`), so there is no narrower prefix to name.
 */
export function useCommercialWrite(): ApiMutation<() => Promise<unknown>, unknown> {
  const client = useQueryClient()

  const mutation = useMutation<unknown, Error, () => Promise<unknown>>({
    mutationFn: (work) => work(),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: commercialQueries.all() })
    },
  })

  return toApiMutation(mutation)
}
