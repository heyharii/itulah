/**
 * The TanStack Query layer for feature screens.
 *
 * Screens already speak `ApiResource` — status, data, errorMessage, reload —
 * so this keeps that vocabulary and puts a real cache underneath it. A screen
 * migrating to Query only has to name its key; nothing downstream changes.
 *
 * This module used to also export `useApiQuery(key, fn)` and
 * `useApiWrite(fn, { invalidates })`, the wrappers every screen was built on
 * before the domains converted. Both reached zero call sites once the last
 * `mutations.ts` landed, and both were listed as anti-patterns in
 * `docs/frontend-rules.md` §9 while still being exported from `@/lib/api` —
 * which is the one place a new screen would look for them. They are gone.
 */

import { useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query"

import { getErrorMessage } from "./client"
import type { ApiResource, AsyncStatus } from "./async-state"

/**
 * Read a `queryOptions` object and hand it back in the shape the screens
 * already speak.
 *
 * The route loader calls `queryClient.query(domainQueries.x())` and the screen
 * calls `useDomainQuery(domainQueries.x())` — one definition, so the loader's
 * fetch is the one the screen subscribes to, and navigation stops waiting for
 * a request that only starts on mount.
 *
 * Built on `useQuery`, not `useSuspenseQuery`, and that is permanent rather
 * than transitional: cancellation does not work with the Suspense hooks, and
 * every fetcher in this estate threads an `AbortSignal` — `fetchInventory`
 * alone fans out into six concurrent requests that navigating away has to be
 * able to abort. See docs/tanstack-gap-plan.md §0.
 *
 * `placeholderData` is deliberately NOT set here. It belongs on paged and
 * filtered lists, where it prevents a flash between pages; on a detail view it
 * shows the previous record's data under the new record's heading. Pass it per
 * query. See docs/frontend-rules.md §Q7.
 */
export function useDomainQuery<T, TKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<T, Error, T, TKey>,
): ApiResource<T> {
  const client = useQueryClient()
  const query = useQuery(options)
  const key = options.queryKey

  const reload = () => {
    void client.invalidateQueries({ queryKey: key })
  }

  const reset = () => {
    client.removeQueries({ queryKey: key })
  }

  const status: AsyncStatus =
    options.enabled === false
      ? "idle"
      : query.isPending
        ? "loading"
        : query.isError
          ? "error"
          : "success"

  const error = query.error instanceof Error ? query.error : undefined

  return {
    status,
    data: query.data,
    error,
    isLoading: status === "loading",
    isRefreshing: query.isFetching && query.data !== undefined,
    errorMessage: error ? getErrorMessage(error) : undefined,
    reload,
    reset,
  }
}
