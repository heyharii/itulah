/**
 * The client for the hub's global search service.
 *
 * `internal/cloud/search` has existed the whole time and this app had never
 * called it — there is even a comment in `forum/api.ts` noting it exists. It is
 * backed by a `search_index` projection (migration 511) covering sku, customer,
 * supplier, po and employee.
 *
 * **On this deployment the index returns nothing.** The endpoint answers 200
 * with an empty `data` array, which means the projection has not been
 * backfilled — `search/backfill.go` and `POST /api/v1/search/reindex` are what
 * populate it. That is a data question for whoever owns the hub, not a reason
 * to build the client differently: the contract is what it is, and an empty
 * result renders as "no matches", which is honest.
 */

import { queryOptions } from "@tanstack/react-query"

import { api, qs } from "@/lib/api"
import { readListEnvelope } from "@/shared/api"

/** One row of the unified index, as the hub returns it. */
export interface SearchHit {
  id: string
  /** What the record is — the only field stable enough to route on. */
  type: string
  recordId: string
  title: string
  subtitle?: string
  /** The hub's own path. Deliberately unused — see `./routes.ts`. */
  routePath?: string
  score?: number
  badge?: { label: string; tone?: string }
  storeId?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value ? value : fallback

function hitFrom(raw: unknown): SearchHit | null {
  const row = asRecord(raw)
  if (!row) return null

  const recordId = text(row.record_id) || text(row.id)
  const type = text(row.type) || text(row.record_type)
  if (!recordId || !type) return null

  const badge = asRecord(row.badge)

  return {
    id: text(row.id, `${type}:${recordId}`),
    type,
    recordId,
    title: text(row.title, recordId),
    subtitle: text(row.subtitle) || undefined,
    routePath: text(row.route_path) || undefined,
    score: typeof row.score === "number" ? row.score : undefined,
    badge: badge ? { label: text(badge.label), tone: text(badge.tone) || undefined } : undefined,
    storeId: text(row.store_id) || undefined,
  }
}

export async function searchGlobal(
  query: string,
  signal: AbortSignal,
  limit = 20,
): Promise<SearchHit[]> {
  const payload = await api.get<unknown>(
    `/v1/search/global${qs({ q: query, limit })}`,
    { signal },
  )
  /* The response is `{data: [...], meta: {...}}` on this hub, but the shared
   * envelope reader handles that and the four other shapes the estate uses. */
  const { items } = readListEnvelope<unknown>(payload)
  return items.map(hitFrom).filter((hit): hit is SearchHit => hit !== null)
}

export const searchQueries = {
  all: () => ["search"] as const,

  /**
   * A global query.
   *
   * `staleTime` is generous and `gcTime` short: the same search typed twice in
   * a minute should not re-hit the index, but yesterday's searches are not
   * worth the memory. Disabled below two characters — a one-letter query
   * matches most of the catalogue and answers nothing.
   */
  global: (query: string) =>
    queryOptions({
      queryKey: [...searchQueries.all(), "global", query] as const,
      queryFn: ({ signal }) => searchGlobal(query, signal),
      enabled: query.trim().length >= 2,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    }),
}
