import { useSuspenseQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { salesSeriesQuery } from "@/screens/executive/data"
import type { ReportScope } from "@/screens/executive/scope"

export interface Place {
  readonly site_id: string
  readonly name: string
  readonly kind: string
}

/// Every shop the company trades from, named the way the sales report names
/// them. Read from this period's sales series — the same answer the pages
/// themselves ask for, so the list costs nothing extra.
export function usePlaces(scope: ReportScope): {
  readonly places: readonly Place[]
  readonly nameOf: (siteId: string) => string
} {
  const series = useSuspenseQuery(salesSeriesQuery(scope.range))
  return useMemo(() => {
    const places = series.data.sites
      .map((site) => ({
        site_id: site.site_id,
        name: site.site_name || site.site_id,
        kind: site.site_kind,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"))
    const names = new Map(places.map((place) => [place.site_id, place.name]))
    return {
      places,
      nameOf: (siteId) =>
        // Head office does not trade, so it is rarely in the series; the
        // series resolves its id from its kind (0603) so no screen spells it.
        names.get(siteId) ??
        (siteId === series.data.head_office_site_id ? "Head office" : siteId),
    }
  }, [series.data])
}
