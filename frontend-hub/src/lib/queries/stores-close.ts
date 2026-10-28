import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { SaleDayPage } from "@itulah/contract"

/// What every shop's till took on one trading day, one row per shop — the
/// reads Finance › Stores › Daily close is composed from. Narrowed to the
/// day by the server; `site` narrows to a shop.
export function listSaleDays(
  from: string,
  to: string,
  site?: string,
  signal?: AbortSignal
): Promise<SaleDayPage> {
  const query = new URLSearchParams({ from, to, limit: "200" })
  if (site !== undefined && site !== "") query.set("site", site)
  return node.get<SaleDayPage>(`/api/v1/finance/sale-days?${query}`, {
    signal,
  })
}

export const saleDaysOnQuery = (from: string, to: string, site?: string) =>
  queryOptions({
    queryKey: ["finance", "sale-days", "close", from, to, site ?? null],
    queryFn: ({ signal }) => listSaleDays(from, to, site, signal),
    refetchInterval: 10_000,
  })
