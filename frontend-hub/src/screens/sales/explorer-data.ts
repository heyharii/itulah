import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  ExplorerOptions,
  ExplorerRow,
  SalesExplorer,
} from "@itulah/contract"

import type { GroupKey } from "@/screens/sales/explorer-model"

/// The questions the Sales Explorer asks of
/// `GET /api/v1/reports/sales/explorer` and its options.

/// Rows a page holds. The table asks for the next page as it scrolls.
export const PAGE = 100

/// One question, as the endpoint takes it. A list that is empty means all.
export interface ExplorerQuery {
  readonly from: string
  readonly to: string
  readonly group: GroupKey
  readonly stores: readonly string[]
  readonly divisions: readonly string[]
  readonly suppliers: readonly string[]
  readonly tags: readonly string[]
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  readonly q: string
  /// Each row at each store, for the per-store table and a phone's cards.
  readonly matrix: boolean
  /// Count the articles in each row: only where a row says it — on a year by
  /// division it costs the server a second pass.
  readonly articles: boolean
}

function paramsOf(query: ExplorerQuery, offset: number, limit: number) {
  const out = new URLSearchParams({ from: query.from, to: query.to })
  out.set("group", query.group)
  const lists: [string, readonly string[]][] = [
    ["stores", query.stores],
    ["divisions", query.divisions],
    ["tags", query.tags],
    ["suppliers", query.suppliers],
    ["colours", query.colours],
    ["sizes", query.sizes],
  ]
  for (const [name, values] of lists) {
    if (values.length > 0) out.set(name, values.join(","))
  }
  if (query.q.trim() !== "") out.set("q", query.q.trim())
  // The server's own order: biggest sales first, a month oldest first, a
  // cashier session newest first.
  if (query.matrix) out.set("matrix", "true")
  // Stock is always asked for: the strip above the table says it.
  out.set("stock", "true")
  if (query.articles) out.set("articles", "true")
  out.set("limit", String(limit))
  // Later pages are rows only: the first page already carries the totals,
  // the stores and the freshness, and the server skips recomputing them.
  if (offset > 0) {
    out.set("offset", String(offset))
    out.set("totals", "false")
  }
  return out
}

export function fetchExplorer(
  query: ExplorerQuery,
  offset: number,
  limit: number,
  signal?: AbortSignal
): Promise<SalesExplorer> {
  return node.get<SalesExplorer>(
    `/api/v1/reports/sales/explorer?${paramsOf(query, offset, limit).toString()}`,
    { signal }
  )
}

/// What the pickers can choose from, and the first and last day with sales.
/// The options are shared with the prefetcher (`prefetch.ts`), so the screen
/// finds the answer warm.
export const explorerOptionsQuery = () =>
  queryOptions({
    queryKey: ["sales", "explorer", "options"],
    queryFn: ({ signal }) =>
      node.get<ExplorerOptions>("/api/v1/reports/sales/explorer/options", {
        signal,
      }),
    staleTime: 5 * 60_000,
  })

export function useExplorerOptions() {
  return useQuery(explorerOptionsQuery())
}

/// The rows of one question, a page at a time. The figures that are not rows —
/// the totals, the stores, the dates — come with every page and are the same
/// in each, so the first page speaks for them.
export const explorerRowsQuery = (query: ExplorerQuery) =>
  infiniteQueryOptions({
    queryKey: ["sales", "explorer", "rows", query],
    queryFn: ({ pageParam, signal }) =>
      fetchExplorer(query, pageParam, PAGE, signal),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.rows.length, 0)
      return last.rows.length > 0 && loaded < last.rows_total
        ? loaded
        : undefined
    },
    // The table under a new question stays as it was until the answer comes:
    // a search typed one letter at a time must not blank the screen.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

export function useExplorerRows(query: ExplorerQuery | null) {
  return useInfiniteQuery({
    // No question yet: the options below are never run (`enabled`), they only
    // give the key its shape.
    ...explorerRowsQuery(query as ExplorerQuery),
    enabled: query !== null,
  })
}

/// One article's (or SKU's) SKUs and the stores they sold in, for its sheet.
/// Asked with the same window and filters as the table, narrowed to the code.
export function useExplorerDetail(base: ExplorerQuery, code: string | null) {
  const query: ExplorerQuery = {
    ...base,
    group: "sku",
    q: code ?? "",
    matrix: true,
    articles: false,
  }
  return useQuery({
    queryKey: ["sales", "explorer", "detail", query],
    enabled: code !== null && code !== "",
    queryFn: ({ signal }) => fetchExplorer(query, 0, 500, signal),
    staleTime: 30_000,
  })
}

export type { ExplorerRow, SalesExplorer }
