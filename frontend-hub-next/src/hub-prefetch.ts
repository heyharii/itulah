import type {
  FetchInfiniteQueryOptions,
  FetchQueryOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query"

export type PrefetchReason = "intent" | "navigate" | "warm"
export interface PrefetchContext {
  readonly reason: PrefetchReason
  readonly search: Readonly<Record<string, unknown>>
}
export type Prefetcher = (
  client: QueryClient,
  context: PrefetchContext
) => Promise<unknown> | void
export type PrefetchMap = Readonly<Record<string, Prefetcher>>

export function warmQuery<T, K extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>
): Promise<void> {
  return client.prefetchQuery(options)
}

export function warmInfinite<T, K extends QueryKey, P>(
  client: QueryClient,
  options: FetchInfiniteQueryOptions<T, Error, T, K, P>
): Promise<void> {
  return client.prefetchInfiniteQuery({
    ...options,
    pages: 1,
  } as FetchInfiniteQueryOptions<T, Error, T, K, P>)
}

export function warmData<T, K extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>
): Promise<T> {
  return client.ensureQueryData({ ...options, revalidateIfStale: true }) as Promise<T>
}

export function intentAllowed(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine !== false
}

export function useIntentPreload(_path: string | null, _delay = 70): void {}

export function startPrefetch(_client: QueryClient): void {}
